package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

const (
	defaultScanCount = 200
	maxScanCount     = 1000
	maxStringPreview = 1 << 20 // 1 MiB，超过则只读预览
	maxCollection    = 500     // 集合类值单次最多展示的条目数
	opTimeout        = 10 * time.Second
	maxDatabases     = 64
)

// ConnectionConfig 是前端提交的连接参数。
type ConnectionConfig struct {
	Name      string `json:"name"`
	Group     string `json:"group"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Username  string `json:"username"`
	Password  string `json:"password"`
	DB        int    `json:"db"`
	UseTLS    bool   `json:"useTLS"`
	ProfileID string `json:"profileID"`
}

// ConnectionInfo 是连接成功后返回给前端的信息。
type ConnectionInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Address string `json:"address"`
	Version string `json:"version"`
}

type DatabaseInfo struct {
	Index int   `json:"index"`
	Keys  int64 `json:"keys"`
}

type KeyInfo struct {
	Key  string `json:"key"`
	Type string `json:"type"`
	TTL  int64  `json:"ttl"` // 秒；-1 表示永不过期，-2 表示键不存在
}

type ScanResult struct {
	Keys    []KeyInfo `json:"keys"`
	Cursor  string    `json:"cursor"`
	HasMore bool      `json:"hasMore"`
}

type Entry struct {
	Field string `json:"field"`
	Value string `json:"value"`
}

// EditRequest 描述一次在线编辑操作。
type EditRequest struct {
	ID     string  `json:"id"`
	DB     int     `json:"db"`
	Key    string  `json:"key"`
	Action string  `json:"action"`
	Field  string  `json:"field"`
	Value  string  `json:"value"`
	Score  float64 `json:"score"`
	Index  int64   `json:"index"`
}

// CreateKeyItem 是新建多值类型时的一组初始数据。
type CreateKeyItem struct {
	Field string  `json:"field"`
	Value string  `json:"value"`
	Score float64 `json:"score"`
}

// CreateKeyRequest 描述一次新建 key 操作。
type CreateKeyRequest struct {
	ID    string          `json:"id"`
	DB    int             `json:"db"`
	Key   string          `json:"key"`
	Type  string          `json:"type"`
	TTL   int64           `json:"ttl"`
	Field string          `json:"field"`
	Value string          `json:"value"`
	Score float64         `json:"score"`
	Index int64           `json:"index"`
	Items []CreateKeyItem `json:"items"`
}

type ValueResult struct {
	Key       string  `json:"key"`
	Type      string  `json:"type"`
	TTL       int64   `json:"ttl"`
	Value     string  `json:"value"`
	Length    int64   `json:"length"`
	Info      []Entry `json:"info"`
	Entries   []Entry `json:"entries"`
	EntryKind string  `json:"entryKind"`
	Truncated bool    `json:"truncated"`
	Editable  bool    `json:"editable"`
}

type connEntry struct {
	cfg ConnectionConfig

	mu      sync.Mutex
	clients map[int]*redis.Client
}

type RedisService struct {
	mu       sync.RWMutex
	conns    map[string]*connEntry
	profiles *profileStore

	subsMu       sync.Mutex
	subs         map[string]*subscription
	eventEmitter func(name string, payload any)
	titleBar     func()
}

func NewRedisService() *RedisService {
	return NewRedisServiceWithConfigPath("")
}

func NewRedisServiceWithConfigPath(path string) *RedisService {
	store, err := newProfileStore(path)
	if err != nil {
		log.Printf("load saved connections: %v", err)
	}
	return &RedisService{
		conns:    make(map[string]*connEntry),
		profiles: store,
		subs:     make(map[string]*subscription),
	}
}

func (e *connEntry) closeAll() {
	e.mu.Lock()
	defer e.mu.Unlock()

	for _, c := range e.clients {
		_ = c.Close()
	}
	e.clients = make(map[int]*redis.Client)
}

func (e *connEntry) client(db int) *redis.Client {
	e.mu.Lock()
	defer e.mu.Unlock()

	if c, ok := e.clients[db]; ok {
		return c
	}

	opts := &redis.Options{
		Addr:     fmt.Sprintf("%s:%d", e.cfg.Host, e.cfg.Port),
		Username: e.cfg.Username,
		Password: e.cfg.Password,
		DB:       db,
	}
	if e.cfg.UseTLS {
		opts.TLSConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: e.cfg.Host,
		}
	}

	c := redis.NewClient(opts)
	e.clients[db] = c
	return c
}

func (s *RedisService) entry(id string) (*connEntry, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	entry, ok := s.conns[id]
	if !ok {
		return nil, newAppError("connNotFound")
	}
	return entry, nil
}

// Connect 建立连接并做一次 PING 校验。
func (s *RedisService) Connect(cfg ConnectionConfig) (ConnectionInfo, error) {
	cfg.Host = strings.TrimSpace(cfg.Host)
	cfg.Group = strings.TrimSpace(cfg.Group)
	if cfg.Host == "" {
		return ConnectionInfo{}, newAppError("hostRequired")
	}
	if cfg.Port <= 0 || cfg.Port > 65535 {
		cfg.Port = 6379
	}
	if cfg.DB < 0 {
		cfg.DB = 0
	}
	if strings.TrimSpace(cfg.Name) == "" {
		cfg.Name = fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)
	}

	entry := &connEntry{cfg: cfg, clients: make(map[int]*redis.Client)}
	client := entry.client(cfg.DB)

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	if err := client.Ping(ctx).Err(); err != nil {
		_ = client.Close()
		return ConnectionInfo{}, newAppError("connectFailed", "detail", err.Error())
	}

	version := ""
	if info, err := client.Info(ctx, "server").Result(); err == nil {
		version = parseRedisVersion(info)
	}

	id := strings.TrimSpace(cfg.ProfileID)
	if id == "" {
		id = randomID()
	}

	s.mu.Lock()
	previous := s.conns[id]
	s.conns[id] = entry
	s.mu.Unlock()
	if previous != nil {
		previous.closeAll()
	}

	if s.profiles != nil {
		profile := ConnectionProfile{
			ID:       id,
			Name:     cfg.Name,
			Group:    cfg.Group,
			Host:     cfg.Host,
			Port:     cfg.Port,
			Username: cfg.Username,
			Password: cfg.Password,
			DB:       cfg.DB,
			UseTLS:   cfg.UseTLS,
		}
		if err := s.profiles.upsert(profile); err != nil {
			log.Printf("save connection profile: %v", err)
		}
	}

	return ConnectionInfo{
		ID:      id,
		Name:    cfg.Name,
		Address: client.Options().Addr,
		Version: version,
	}, nil
}

// Disconnect 关闭连接及其所有 DB 的客户端，但保留已保存的连接信息。
func (s *RedisService) Disconnect(id string) error {
	s.closeSubscriptions(id)

	s.mu.Lock()
	entry, ok := s.conns[id]
	delete(s.conns, id)
	s.mu.Unlock()

	if ok && entry != nil {
		entry.closeAll()
	}
	return nil
}

// ListSavedConnections 返回用户配置目录中保存的连接信息。
func (s *RedisService) ListSavedConnections() []ConnectionProfile {
	if s.profiles == nil {
		return []ConnectionProfile{}
	}
	return s.profiles.list()
}

// UpdateSavedConnection 修改一条已保存的连接；连接处于活动状态时不允许修改。
func (s *RedisService) UpdateSavedConnection(profile ConnectionProfile) error {
	if s.profiles == nil {
		return errors.New("connection store is not configured")
	}

	profile.ID = strings.TrimSpace(profile.ID)
	if profile.ID == "" {
		return newAppError("connNotFound")
	}
	if _, ok := s.profiles.get(profile.ID); !ok {
		return newAppError("connNotFound")
	}

	s.mu.RLock()
	_, active := s.conns[profile.ID]
	s.mu.RUnlock()
	if active {
		return newAppError("connectionActive")
	}

	profile.Host = strings.TrimSpace(profile.Host)
	profile.Group = strings.TrimSpace(profile.Group)
	if profile.Host == "" {
		return newAppError("hostRequired")
	}
	if profile.Port <= 0 || profile.Port > 65535 {
		profile.Port = 6379
	}
	if profile.DB < 0 {
		profile.DB = 0
	}
	if strings.TrimSpace(profile.Name) == "" {
		profile.Name = fmt.Sprintf("%s:%d", profile.Host, profile.Port)
	}

	return s.profiles.update(profile)
}

// DeleteSavedConnection 删除已保存的连接；若当前已连接则一并断开。
func (s *RedisService) DeleteSavedConnection(id string) error {
	s.closeSubscriptions(id)

	s.mu.Lock()
	entry := s.conns[id]
	delete(s.conns, id)
	s.mu.Unlock()

	if entry != nil {
		entry.closeAll()
	}
	if s.profiles == nil {
		return nil
	}
	return s.profiles.remove(id)
}

// ListDatabases 返回数据库列表及各自 key 数量。
func (s *RedisService) ListDatabases(id string) ([]DatabaseInfo, error) {
	entry, err := s.entry(id)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	count := 16
	if values, err := entry.client(0).ConfigGet(ctx, "databases").Result(); err == nil {
		if n, convErr := strconv.Atoi(values["databases"]); convErr == nil && n > 0 {
			count = n
		}
	}
	if count > maxDatabases {
		count = maxDatabases
	}

	result := make([]DatabaseInfo, count)
	var wg sync.WaitGroup
	sem := make(chan struct{}, 8)

	for i := 0; i < count; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			dbCtx, dbCancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer dbCancel()

			keys, dbErr := entry.client(idx).DBSize(dbCtx).Result()
			if dbErr != nil {
				keys = -1
			}
			result[idx] = DatabaseInfo{Index: idx, Keys: keys}
		}(i)
	}
	wg.Wait()

	return result, nil
}

// ScanKeys 使用 SCAN 游标增量读取 key，避免阻塞 Redis。
func (s *RedisService) ScanKeys(id string, db int, cursor string, pattern string, count int) (ScanResult, error) {
	entry, err := s.entry(id)
	if err != nil {
		return ScanResult{}, err
	}

	cur := uint64(0)
	if strings.TrimSpace(cursor) != "" {
		cur, err = strconv.ParseUint(cursor, 10, 64)
		if err != nil {
			return ScanResult{}, newAppError("invalidCursor", "cursor", cursor)
		}
	}
	if count <= 0 {
		count = defaultScanCount
	}
	if count > maxScanCount {
		count = maxScanCount
	}
	if strings.TrimSpace(pattern) == "" {
		pattern = "*"
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	client := entry.client(db)
	keys, next, err := client.Scan(ctx, cur, pattern, int64(count)).Result()
	if err != nil {
		return ScanResult{}, err
	}

	result := ScanResult{
		Keys:    make([]KeyInfo, 0, len(keys)),
		Cursor:  strconv.FormatUint(next, 10),
		HasMore: next != 0,
	}
	if len(keys) == 0 {
		return result, nil
	}

	pipe := client.Pipeline()
	typeCmds := make([]*redis.StatusCmd, len(keys))
	ttlCmds := make([]*redis.Cmd, len(keys))
	for i, key := range keys {
		typeCmds[i] = pipe.Type(ctx, key)
		ttlCmds[i] = pipe.Do(ctx, "TTL", key)
	}
	_, _ = pipe.Exec(ctx)

	for i, key := range keys {
		typ := typeCmds[i].Val()
		if typ == "" {
			typ = "none"
		}
		ttl := int64(-1)
		if v, ttlErr := ttlCmds[i].Int64(); ttlErr == nil {
			ttl = v
		}
		result.Keys = append(result.Keys, KeyInfo{Key: key, Type: typ, TTL: ttl})
	}

	return result, nil
}

// GetValue 根据 key 类型返回结构化的值，集合类最多返回 maxCollection 条。
func (s *RedisService) GetValue(id string, db int, key string) (ValueResult, error) {
	entry, err := s.entry(id)
	if err != nil {
		return ValueResult{}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	client := entry.client(db)
	typ, err := client.Type(ctx, key).Result()
	if err != nil {
		return ValueResult{}, err
	}
	if typ == "none" {
		return ValueResult{}, newAppError("keyNotFound", "key", key)
	}

	result := ValueResult{
		Key:     key,
		Type:    typ,
		Info:    []Entry{},
		Entries: []Entry{},
	}
	if ttl, ttlErr := client.Do(ctx, "TTL", key).Int64(); ttlErr == nil {
		result.TTL = ttl
	}

	switch typ {
	case "string":
		length, _ := client.StrLen(ctx, key).Result()
		result.Length = length

		value, getErr := client.GetRange(ctx, key, 0, maxStringPreview-1).Result()
		if getErr != nil && !errors.Is(getErr, redis.Nil) {
			return ValueResult{}, getErr
		}
		result.Value = value
		result.Truncated = length > int64(len(value))
		result.Editable = !result.Truncated

	case "ReJSON-RL", "ReJSON", "json":
		raw, jsonErr := client.JSONGet(ctx, key).Result()
		if jsonErr != nil {
			return ValueResult{}, newAppError("jsonReadFailed", "detail", jsonErr.Error())
		}
		result.Value = raw
		if pretty, prettyErr := prettyJSON(raw); prettyErr == nil {
			result.Value = pretty
		}
		result.Length = int64(len(raw))
		result.Editable = false

	case "list":
		length, listErr := client.LLen(ctx, key).Result()
		if listErr != nil {
			return ValueResult{}, listErr
		}
		result.Length = length

		items, listErr := client.LRange(ctx, key, 0, maxCollection-1).Result()
		if listErr != nil {
			return ValueResult{}, listErr
		}
		for i, item := range items {
			result.Entries = append(result.Entries, Entry{Field: strconv.Itoa(i), Value: item})
		}
		result.Truncated = length > int64(len(items))

	case "set":
		length, setErr := client.SCard(ctx, key).Result()
		if setErr != nil {
			return ValueResult{}, setErr
		}
		result.Length = length

		members, _, setErr := client.SScan(ctx, key, 0, "", int64(maxCollection)).Result()
		if setErr != nil {
			return ValueResult{}, setErr
		}
		sort.Strings(members)
		for _, member := range members {
			result.Entries = append(result.Entries, Entry{Value: member})
		}
		result.Truncated = length > int64(len(members))

	case "zset":
		length, zErr := client.ZCard(ctx, key).Result()
		if zErr != nil {
			return ValueResult{}, zErr
		}
		result.Length = length

		items, zErr := client.ZRevRangeWithScores(ctx, key, 0, maxCollection-1).Result()
		if zErr != nil {
			return ValueResult{}, zErr
		}
		for _, item := range items {
			member, ok := item.Member.(string)
			if !ok {
				member = fmt.Sprint(item.Member)
			}
			result.Entries = append(result.Entries, Entry{
				Field: member,
				Value: strconv.FormatFloat(item.Score, 'f', -1, 64),
			})
		}
		result.Truncated = length > int64(len(items))

	case "hash":
		length, hErr := client.HLen(ctx, key).Result()
		if hErr != nil {
			return ValueResult{}, hErr
		}
		result.Length = length

		flat, _, hErr := client.HScan(ctx, key, 0, "", int64(maxCollection)).Result()
		if hErr != nil {
			return ValueResult{}, hErr
		}
		entries := make([]Entry, 0, len(flat)/2)
		for i := 0; i+1 < len(flat); i += 2 {
			entries = append(entries, Entry{Field: flat[i], Value: flat[i+1]})
		}
		sort.Slice(entries, func(i, j int) bool { return entries[i].Field < entries[j].Field })
		result.Entries = append(result.Entries, entries...)
		result.Truncated = length > int64(len(entries))

	case "stream":
		length, sErr := client.XLen(ctx, key).Result()
		if sErr != nil {
			return ValueResult{}, sErr
		}
		result.Length = length

		messages, sErr := client.XRangeN(ctx, key, "-", "+", maxCollection).Result()
		if sErr != nil {
			return ValueResult{}, sErr
		}
		for _, message := range messages {
			payload, marshalErr := json.Marshal(message.Values)
			if marshalErr != nil {
				payload = []byte(fmt.Sprint(message.Values))
			}
			result.Entries = append(result.Entries, Entry{Field: message.ID, Value: string(payload)})
		}
		result.Truncated = length > int64(len(messages))

	case "TSDB-TYPE":
		infoRaw, infoErr := client.Do(ctx, "TS.INFO", key).Result()
		if infoErr != nil {
			return ValueResult{}, infoErr
		}
		result.Info = moduleInfo(infoRaw, tsInfoOrder)

		samplesRaw, sampleErr := client.Do(ctx, "TS.RANGE", key, "-", "+", "COUNT", maxCollection).Result()
		if sampleErr != nil {
			return ValueResult{}, sampleErr
		}
		result.EntryKind = "timeseries"
		result.Entries = tsEntries(samplesRaw)
		result.Length = infoNumber(result.Info, "totalSamples")
		result.Truncated = result.Length > int64(len(result.Entries))

	case "MBbloom--":
		infoRaw, infoErr := client.Do(ctx, "BF.INFO", key).Result()
		if infoErr != nil {
			return ValueResult{}, infoErr
		}
		result.Info = moduleInfo(infoRaw, bloomInfoOrder)
		result.Length = infoNumber(result.Info, "Number of items inserted")

	case "MBbloomCF":
		infoRaw, infoErr := client.Do(ctx, "CF.INFO", key).Result()
		if infoErr != nil {
			return ValueResult{}, infoErr
		}
		result.Info = moduleInfo(infoRaw, cuckooInfoOrder)
		result.Length = infoNumber(result.Info, "Number of items inserted")

	case "CMSk-TYPE":
		infoRaw, infoErr := client.Do(ctx, "CMS.INFO", key).Result()
		if infoErr != nil {
			return ValueResult{}, infoErr
		}
		result.Info = moduleInfo(infoRaw, cmsInfoOrder)
		result.Length = infoNumber(result.Info, "count")

	case "TopK-TYPE":
		infoRaw, infoErr := client.Do(ctx, "TOPK.INFO", key).Result()
		if infoErr != nil {
			return ValueResult{}, infoErr
		}
		result.Info = moduleInfo(infoRaw, topKInfoOrder)

		listRaw, listErr := client.Do(ctx, "TOPK.LIST", key).Result()
		if listErr != nil {
			return ValueResult{}, listErr
		}
		result.EntryKind = "topk"
		for i, member := range stringList(listRaw) {
			result.Entries = append(result.Entries, Entry{Field: strconv.Itoa(i + 1), Value: member})
		}

	case "TDIS-TYPE":
		infoRaw, infoErr := client.Do(ctx, "TDIGEST.INFO", key).Result()
		if infoErr != nil {
			return ValueResult{}, infoErr
		}
		result.Info = moduleInfo(infoRaw, tDigestInfoOrder)

		result.EntryKind = "tdigest"
		for _, query := range []struct {
			label string
			arg   string
		}{
			{"P50", "0.5"},
			{"P90", "0.9"},
			{"P99", "0.99"},
		} {
			raw, quantileErr := client.Do(ctx, "TDIGEST.QUANTILE", key, query.arg).Result()
			if quantileErr != nil {
				continue
			}
			result.Entries = append(result.Entries, Entry{Field: query.label, Value: firstNumber(raw)})
		}
		result.Length = infoNumber(result.Info, "Observations")

	case "vectorset":
		infoRaw, infoErr := client.Do(ctx, "VINFO", key).Result()
		if infoErr != nil {
			return ValueResult{}, infoErr
		}
		result.Info = moduleInfo(infoRaw, vectorInfoOrder)
		result.Length = infoNumber(result.Info, "size")
		result.EntryKind = "vectorset"

		membersRaw, membersErr := client.Do(ctx, "VRANDMEMBER", key, 5).Result()
		if membersErr == nil {
			for _, member := range stringList(membersRaw) {
				embeddingRaw, embedErr := client.Do(ctx, "VEMB", key, member).Result()
				if embedErr != nil {
					continue
				}
				result.Entries = append(result.Entries, Entry{Field: member, Value: formatVector(embeddingRaw)})
			}
		}

	default:
		result.Value = "(暂不支持展示的类型: " + typ + ")"
	}

	return result, nil
}

// SetString 写入字符串值；ttlSeconds > 0 时设置过期时间。
func (s *RedisService) SetString(id string, db int, key string, value string, ttlSeconds int64) error {
	entry, err := s.entry(id)
	if err != nil {
		return err
	}
	key = strings.TrimSpace(key)
	if key == "" {
		return newAppError("keyRequired")
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	client := entry.client(db)
	typ, err := client.Type(ctx, key).Result()
	if err != nil {
		return err
	}
	if typ != "none" && typ != "string" {
		return newAppError("typeNotString", "type", typ)
	}

	if ttlSeconds > 0 {
		return client.Set(ctx, key, value, time.Duration(ttlSeconds)*time.Second).Err()
	}
	return client.Set(ctx, key, value, 0).Err()
}

func (s *RedisService) DeleteKey(id string, db int, key string) error {
	entry, err := s.entry(id)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	return entry.client(db).Del(ctx, key).Err()
}

// CreateKey 创建一个指定类型的新 key。
func (s *RedisService) CreateKey(req CreateKeyRequest) error {
	entry, err := s.entry(req.ID)
	if err != nil {
		return err
	}

	key := strings.TrimSpace(req.Key)
	if key == "" {
		return newAppError("keyRequired")
	}
	if req.TTL < 0 {
		req.TTL = 0
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	client := entry.client(req.DB)
	exists, err := client.Exists(ctx, key).Result()
	if err != nil {
		return err
	}
	if exists > 0 {
		return newAppError("keyExists", "key", key)
	}

	switch req.Type {
	case "string":
		ttl := time.Duration(0)
		if req.TTL > 0 {
			ttl = time.Duration(req.TTL) * time.Second
		}
		if err := client.Set(ctx, key, req.Value, ttl).Err(); err != nil {
			return err
		}

	case "hash":
		items := req.Items
		if len(items) == 0 && (req.Field != "" || req.Value != "") {
			items = []CreateKeyItem{{Field: req.Field, Value: req.Value}}
		}
		if len(items) == 0 {
			return newAppError("needField")
		}
		fields := make(map[string]interface{}, len(items))
		for _, item := range items {
			if item.Field == "" {
				return newAppError("fieldRequired")
			}
			fields[item.Field] = item.Value
		}
		if err := client.HSet(ctx, key, fields).Err(); err != nil {
			return err
		}

	case "list":
		items := req.Items
		if len(items) == 0 && req.Value != "" {
			items = []CreateKeyItem{{Value: req.Value}}
		}
		if len(items) == 0 {
			return newAppError("needElement")
		}
		values := make([]interface{}, 0, len(items))
		for _, item := range items {
			if item.Value == "" {
				return newAppError("initialElementEmpty")
			}
			values = append(values, item.Value)
		}
		if err := client.RPush(ctx, key, values...).Err(); err != nil {
			return err
		}

	case "set":
		items := req.Items
		if len(items) == 0 && req.Field != "" {
			items = []CreateKeyItem{{Field: req.Field}}
		}
		if len(items) == 0 {
			return newAppError("needMember")
		}
		members := make([]interface{}, 0, len(items))
		for _, item := range items {
			member := item.Value
			if member == "" {
				member = item.Field
			}
			if member == "" {
				return newAppError("memberRequired")
			}
			members = append(members, member)
		}
		if err := client.SAdd(ctx, key, members...).Err(); err != nil {
			return err
		}

	case "zset":
		items := req.Items
		if len(items) == 0 && req.Field != "" {
			items = []CreateKeyItem{{Field: req.Field, Score: req.Score}}
		}
		if len(items) == 0 {
			return newAppError("needMember")
		}
		zs := make([]redis.Z, 0, len(items))
		for _, item := range items {
			if item.Field == "" {
				return newAppError("memberRequired")
			}
			zs = append(zs, redis.Z{Score: item.Score, Member: item.Field})
		}
		if err := client.ZAdd(ctx, key, zs...).Err(); err != nil {
			return err
		}

	case "stream":
		messages := make([]string, 0, len(req.Items))
		for _, item := range req.Items {
			if item.Value != "" {
				messages = append(messages, item.Value)
			}
		}
		if len(messages) == 0 && req.Value != "" {
			messages = []string{req.Value}
		}
		if len(messages) == 0 {
			return newAppError("needMessage")
		}
		for _, raw := range messages {
			var fields map[string]interface{}
			if err := json.Unmarshal([]byte(raw), &fields); err != nil {
				_ = client.Del(ctx, key).Err()
				return newAppError("messageFieldsObject")
			}
			if len(fields) == 0 {
				_ = client.Del(ctx, key).Err()
				return newAppError("messageFieldsEmpty")
			}
			if err := client.XAdd(ctx, &redis.XAddArgs{Stream: key, Values: fields}).Err(); err != nil {
				_ = client.Del(ctx, key).Err()
				return err
			}
		}

	case "ReJSON-RL", "ReJSON", "json":
		if !json.Valid([]byte(req.Value)) {
			return newAppError("jsonInvalid")
		}
		if err := client.Do(ctx, "JSON.SET", key, "$", req.Value).Err(); err != nil {
			return err
		}

	case "TSDB-TYPE":
		value, parseErr := strconv.ParseFloat(req.Value, 64)
		if parseErr != nil {
			return newAppError("sampleValueNumber")
		}
		if err := client.Do(ctx, "TS.CREATE", key).Err(); err != nil {
			return err
		}
		timestamp := "*"
		if req.Index > 0 {
			timestamp = strconv.FormatInt(req.Index, 10)
		}
		if err := client.Do(ctx, "TS.ADD", key, timestamp, value).Err(); err != nil {
			_ = client.Del(ctx, key).Err()
			return err
		}

	case "MBbloom--":
		if req.Field == "" {
			return newAppError("elementRequired")
		}
		if err := client.Do(ctx, "BF.ADD", key, req.Field).Err(); err != nil {
			return err
		}

	case "MBbloomCF":
		if req.Field == "" {
			return newAppError("elementRequired")
		}
		if err := client.Do(ctx, "CF.ADD", key, req.Field).Err(); err != nil {
			return err
		}

	case "CMSk-TYPE":
		if req.Field == "" {
			return newAppError("elementRequired")
		}
		if err := client.Do(ctx, "CMS.INITBYPROB", key, 0.001, 0.01).Err(); err != nil {
			return err
		}
		increment := req.Index
		if increment <= 0 {
			increment = 1
		}
		if err := client.Do(ctx, "CMS.INCRBY", key, req.Field, increment).Err(); err != nil {
			_ = client.Del(ctx, key).Err()
			return err
		}

	case "TopK-TYPE":
		if req.Field == "" {
			return newAppError("elementRequired")
		}
		k := req.Index
		if k <= 0 {
			k = 10
		}
		if err := client.Do(ctx, "TOPK.RESERVE", key, k).Err(); err != nil {
			return err
		}
		if err := client.Do(ctx, "TOPK.ADD", key, req.Field).Err(); err != nil {
			_ = client.Del(ctx, key).Err()
			return err
		}

	case "TDIS-TYPE":
		value, parseErr := strconv.ParseFloat(req.Value, 64)
		if parseErr != nil {
			return newAppError("numberInvalid")
		}
		if err := client.Do(ctx, "TDIGEST.CREATE", key).Err(); err != nil {
			return err
		}
		if err := client.Do(ctx, "TDIGEST.ADD", key, value).Err(); err != nil {
			_ = client.Del(ctx, key).Err()
			return err
		}

	case "vectorset":
		if req.Field == "" {
			return newAppError("elementNameRequired")
		}
		values, parseErr := parseVectorValues(req.Value)
		if parseErr != nil {
			return parseErr
		}
		args := []interface{}{"VADD", key, "VALUES", len(values)}
		for _, value := range values {
			args = append(args, value)
		}
		args = append(args, req.Field)
		if err := client.Do(ctx, args...).Err(); err != nil {
			return err
		}

	default:
		return newAppError("unsupportedType", "type", req.Type)
	}

	if req.TTL > 0 && req.Type != "string" {
		if err := client.Expire(ctx, key, time.Duration(req.TTL)*time.Second).Err(); err != nil {
			return err
		}
	}

	return nil
}

// Edit 对指定 key 执行一次编辑操作，具体命令由 Action 决定。
func (s *RedisService) Edit(req EditRequest) error {
	entry, err := s.entry(req.ID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(req.Key) == "" {
		return newAppError("keyRequired")
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	client := entry.client(req.DB)
	key := req.Key

	switch req.Action {
	case "json.set":
		if !json.Valid([]byte(req.Value)) {
			return newAppError("jsonInvalid")
		}
		return client.Do(ctx, "JSON.SET", key, "$", req.Value).Err()

	case "hash.set":
		if req.Field == "" {
			return newAppError("fieldRequired")
		}
		return client.HSet(ctx, key, req.Field, req.Value).Err()

	case "hash.del":
		if req.Field == "" {
			return newAppError("fieldRequired")
		}
		return client.HDel(ctx, key, req.Field).Err()

	case "list.set":
		return client.LSet(ctx, key, req.Index, req.Value).Err()

	case "list.push":
		return client.RPush(ctx, key, req.Value).Err()

	case "list.del":
		// LSET + LREM 实现按下标删除，避免误删同值的其他元素。
		sentinel := "\x00redis-studio-deleted:" + randomID()
		if err := client.LSet(ctx, key, req.Index, sentinel).Err(); err != nil {
			return err
		}
		return client.LRem(ctx, key, 1, sentinel).Err()

	case "set.add":
		if req.Field == "" {
			return newAppError("memberRequired")
		}
		return client.SAdd(ctx, key, req.Field).Err()

	case "set.del":
		if req.Field == "" {
			return newAppError("memberRequired")
		}
		return client.SRem(ctx, key, req.Field).Err()

	case "zset.set":
		if req.Field == "" {
			return newAppError("memberRequired")
		}
		return client.ZAdd(ctx, key, redis.Z{Score: req.Score, Member: req.Field}).Err()

	case "zset.del":
		if req.Field == "" {
			return newAppError("memberRequired")
		}
		return client.ZRem(ctx, key, req.Field).Err()

	case "stream.add":
		var fields map[string]interface{}
		if unmarshalErr := json.Unmarshal([]byte(req.Value), &fields); unmarshalErr != nil {
			return newAppError("messageFieldsObject")
		}
		if len(fields) == 0 {
			return newAppError("messageFieldsEmpty")
		}
		return client.XAdd(ctx, &redis.XAddArgs{Stream: key, Values: fields}).Err()

	case "stream.del":
		if req.Field == "" {
			return newAppError("messageIdRequired")
		}
		return client.XDel(ctx, key, req.Field).Err()

	case "ts.add":
		value, parseErr := strconv.ParseFloat(req.Value, 64)
		if parseErr != nil {
			return newAppError("sampleValueNumber")
		}
		timestamp := "*"
		if req.Index > 0 {
			timestamp = strconv.FormatInt(req.Index, 10)
		}
		return client.Do(ctx, "TS.ADD", key, timestamp, value).Err()

	case "bloom.add":
		if req.Field == "" {
			return newAppError("elementRequired")
		}
		return client.Do(ctx, "BF.ADD", key, req.Field).Err()

	case "cuckoo.add":
		if req.Field == "" {
			return newAppError("elementRequired")
		}
		return client.Do(ctx, "CF.ADD", key, req.Field).Err()

	case "cms.incr":
		if req.Field == "" {
			return newAppError("elementRequired")
		}
		increment := req.Index
		if increment <= 0 {
			increment = 1
		}
		return client.Do(ctx, "CMS.INCRBY", key, req.Field, increment).Err()

	case "topk.add":
		if req.Field == "" {
			return newAppError("elementRequired")
		}
		return client.Do(ctx, "TOPK.ADD", key, req.Field).Err()

	case "tdigest.add":
		value, parseErr := strconv.ParseFloat(req.Value, 64)
		if parseErr != nil {
			return newAppError("numberInvalid")
		}
		return client.Do(ctx, "TDIGEST.ADD", key, value).Err()

	case "vector.add":
		if req.Field == "" {
			return newAppError("elementNameRequired")
		}
		values, parseErr := parseVectorValues(req.Value)
		if parseErr != nil {
			return parseErr
		}
		args := []interface{}{"VADD", key, "VALUES", len(values)}
		for _, value := range values {
			args = append(args, value)
		}
		args = append(args, req.Field)
		return client.Do(ctx, args...).Err()

	default:
		return newAppError("unsupportedAction", "action", req.Action)
	}
}

var (
	tsInfoOrder = []string{
		"totalSamples", "memoryUsage", "retentionTime", "chunkCount", "chunkSize",
		"chunkType", "duplicatePolicy", "firstTimestamp", "lastTimestamp",
		"labels", "rules", "sourceKey", "ignoreMaxTimeDiff", "ignoreMaxValDiff",
	}
	bloomInfoOrder  = []string{"Capacity", "Size", "Number of filters", "Number of items inserted", "Expansion rate"}
	cuckooInfoOrder = []string{
		"Size", "Number of buckets", "Bucket size", "Number of filters",
		"Number of items inserted", "Number of items deleted", "Expansion rate", "Max iterations",
	}
	cmsInfoOrder     = []string{"width", "depth", "count"}
	topKInfoOrder    = []string{"k", "width", "depth", "decay"}
	tDigestInfoOrder = []string{
		"Compression", "Capacity", "Observations", "Merged nodes", "Unmerged nodes",
		"Merged weight", "Unmerged weight", "Total compressions", "Memory usage",
	}
	vectorInfoOrder = []string{
		"size", "vector-dim", "quant-type", "hnsw-m", "max-level",
		"hnsw-max-node-uid", "attributes-count", "projection-input-dim", "vset-uid",
	}
)

func moduleInfo(raw interface{}, preferred []string) []Entry {
	values := make(map[string]string)

	switch data := raw.(type) {
	case map[interface{}]interface{}:
		for key, value := range data {
			if text := formatInfoValue(value); text != "" {
				values[fmt.Sprint(key)] = text
			}
		}
	case map[string]interface{}:
		for key, value := range data {
			if text := formatInfoValue(value); text != "" {
				values[key] = text
			}
		}
	case []interface{}:
		for i := 0; i+1 < len(data); i += 2 {
			if text := formatInfoValue(data[i+1]); text != "" {
				values[fmt.Sprint(data[i])] = text
			}
		}
	}

	entries := make([]Entry, 0, len(values))
	seen := make(map[string]bool, len(values))
	for _, name := range preferred {
		if text, ok := values[name]; ok {
			entries = append(entries, Entry{Field: name, Value: text})
			seen[name] = true
		}
	}

	rest := make([]string, 0, len(values))
	for name := range values {
		if !seen[name] {
			rest = append(rest, name)
		}
	}
	sort.Strings(rest)
	for _, name := range rest {
		entries = append(entries, Entry{Field: name, Value: values[name]})
	}

	return entries
}

func formatInfoValue(value interface{}) string {
	switch val := value.(type) {
	case nil:
		return ""
	case string:
		return val
	case []byte:
		return string(val)
	case bool:
		return strconv.FormatBool(val)
	case int:
		return strconv.Itoa(val)
	case int64:
		return strconv.FormatInt(val, 10)
	case uint64:
		return strconv.FormatUint(val, 10)
	case float32:
		return strconv.FormatFloat(float64(val), 'f', -1, 32)
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case []interface{}:
		parts := make([]string, 0, len(val))
		for _, item := range val {
			if text := formatInfoValue(item); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, ", ")
	case map[interface{}]interface{}:
		normalized := make(map[string]interface{}, len(val))
		for key, item := range val {
			normalized[fmt.Sprint(key)] = item
		}
		return formatInfoMap(normalized)
	case map[string]interface{}:
		return formatInfoMap(val)
	default:
		return fmt.Sprint(val)
	}
}

func formatInfoMap(values map[string]interface{}) string {
	if len(values) == 0 {
		return ""
	}

	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		if text := formatInfoValue(values[key]); text != "" {
			parts = append(parts, key+"="+text)
		}
	}
	return strings.Join(parts, ", ")
}

func tsEntries(raw interface{}) []Entry {
	rows, ok := raw.([]interface{})
	if !ok {
		return nil
	}

	entries := make([]Entry, 0, len(rows))
	for _, row := range rows {
		pair, ok := row.([]interface{})
		if !ok || len(pair) < 2 {
			continue
		}
		entries = append(entries, Entry{
			Field: formatTimestampValue(pair[0]),
			Value: formatInfoValue(pair[1]),
		})
	}
	return entries
}

func formatTimestampValue(value interface{}) string {
	var millis int64
	switch val := value.(type) {
	case int64:
		millis = val
	case float64:
		millis = int64(val)
	default:
		return fmt.Sprint(value)
	}
	return time.UnixMilli(millis).Format("2006-01-02 15:04:05.000")
}

func stringList(raw interface{}) []string {
	if list, ok := raw.([]interface{}); ok {
		out := make([]string, 0, len(list))
		for _, item := range list {
			out = append(out, fmt.Sprint(item))
		}
		return out
	}
	if text, ok := raw.(string); ok {
		return []string{text}
	}
	return nil
}

func firstNumber(raw interface{}) string {
	if list, ok := raw.([]interface{}); ok && len(list) > 0 {
		return formatInfoValue(list[0])
	}
	return formatInfoValue(raw)
}

func infoNumber(entries []Entry, name string) int64 {
	for _, entry := range entries {
		if entry.Field == name {
			number, _ := strconv.ParseInt(entry.Value, 10, 64)
			return number
		}
	}
	return 0
}

func parseVectorValues(raw string) ([]float64, error) {
	parts := strings.FieldsFunc(raw, func(r rune) bool {
		return r == ',' || r == ' ' || r == '\n' || r == '\t' || r == ';'
	})
	if len(parts) == 0 {
		return nil, newAppError("vectorEmpty")
	}

	values := make([]float64, 0, len(parts))
	for _, part := range parts {
		value, err := strconv.ParseFloat(part, 64)
		if err != nil {
			return nil, newAppError("vectorInvalidNumber", "value", part)
		}
		values = append(values, value)
	}
	return values, nil
}

func formatVector(raw interface{}) string {
	list, ok := raw.([]interface{})
	if !ok {
		return formatInfoValue(raw)
	}

	parts := make([]string, 0, len(list))
	for _, value := range list {
		switch number := value.(type) {
		case float64:
			parts = append(parts, strconv.FormatFloat(number, 'f', 4, 64))
		case int64:
			parts = append(parts, strconv.FormatInt(number, 10))
		default:
			parts = append(parts, fmt.Sprint(number))
		}
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

// prettyJSON 对 JSON 做缩进格式化，保留原始数字精度和字段顺序。
func prettyJSON(raw string) (string, error) {
	if strings.TrimSpace(raw) == "" {
		return raw, nil
	}

	var buf bytes.Buffer
	if err := json.Indent(&buf, []byte(raw), "", "  "); err != nil {
		return "", err
	}
	return buf.String(), nil
}

func randomID() string {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return strconv.FormatInt(time.Now().UnixNano(), 16)
	}
	return hex.EncodeToString(buf)
}

func parseRedisVersion(info string) string {
	for _, line := range strings.Split(info, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "redis_version:") {
			return strings.TrimPrefix(line, "redis_version:")
		}
	}
	return ""
}
