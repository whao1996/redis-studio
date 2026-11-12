package main

import (
	"context"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type DatabaseStatus struct {
	Index   int   `json:"index"`
	Keys    int64 `json:"keys"`
	Expires int64 `json:"expires"`
	AvgTTL  int64 `json:"avgTTL"`
}

type CommandStat struct {
	Name  string `json:"name"`
	Calls int64  `json:"calls"`
}

type SlowQuery struct {
	ID         int64   `json:"id"`
	Time       int64   `json:"time"`
	DurationMs float64 `json:"durationMs"`
	Summary    string  `json:"summary"`
	Command    string  `json:"command"`
	ClientAddr string  `json:"clientAddr"`
}

type SlowLogData struct {
	Entries     []SlowQuery `json:"entries"`
	ThresholdMs float64     `json:"thresholdMs"`
	MaxLen      int64       `json:"maxLen"`
	Total       int64       `json:"total"`
}

type InstanceStatus struct {
	Name         string `json:"name"`
	Address      string `json:"address"`
	Version      string `json:"version"`
	Mode         string `json:"mode"`
	Role         string `json:"role"`
	OS           string `json:"os"`
	ArchBits     string `json:"archBits"`
	ProcessID    int64  `json:"processID"`
	UptimeSecond int64  `json:"uptimeSeconds"`

	UsedMemory          int64   `json:"usedMemory"`
	UsedMemoryHuman     string  `json:"usedMemoryHuman"`
	UsedMemoryPeakHuman string  `json:"usedMemoryPeakHuman"`
	UsedMemoryRSSHuman  string  `json:"usedMemoryRSSHuman"`
	MemoryFragmentation float64 `json:"memoryFragmentation"`
	MaxMemory           int64   `json:"maxMemory"`

	MaxClients               int64 `json:"maxClients"`
	ConnectedClients         int64 `json:"connectedClients"`
	BlockedClients           int64 `json:"blockedClients"`
	TotalConnectionsReceived int64 `json:"totalConnectionsReceived"`
	TotalCommandsProcessed   int64 `json:"totalCommandsProcessed"`
	InstantaneousOpsPerSec   int64 `json:"instantaneousOpsPerSec"`

	KeyspaceHits        int64   `json:"keyspaceHits"`
	KeyspaceMisses      int64   `json:"keyspaceMisses"`
	HitRate             float64 `json:"hitRate"`
	ExpiredKeys         int64   `json:"expiredKeys"`
	EvictedKeys         int64   `json:"evictedKeys"`
	RejectedConnections int64   `json:"rejectedConnections"`

	RDBLastSaveTime int64  `json:"rdbLastSaveTime"`
	RDBInProgress   bool   `json:"rdbInProgress"`
	AOFEnabled      bool   `json:"aofEnabled"`
	AOFLastWrite    string `json:"aofLastWrite"`
	AOFCurrentSize  int64  `json:"aofCurrentSize"`

	ConnectedSlaves  int64  `json:"connectedSlaves"`
	MaxReplicaLag    int64  `json:"maxReplicaLag"`
	MasterHost       string `json:"masterHost"`
	MasterPort       int64  `json:"masterPort"`
	MasterLinkStatus string `json:"masterLinkStatus"`

	Commands          []CommandStat `json:"commands"`
	CommandTotalCalls int64         `json:"commandTotalCalls"`

	SlowQueries        []SlowQuery `json:"slowQueries"`
	SlowlogThresholdMs float64     `json:"slowlogThresholdMs"`
	SlowlogCount       int64       `json:"slowlogCount"`

	Databases []DatabaseStatus `json:"databases"`
}

// GetSlowLog 返回慢日志条目、阈值、容量上限和累计条数。
func (s *RedisService) GetSlowLog(connectionID string, limit int) (SlowLogData, error) {
	entry, err := s.entry(connectionID)
	if err != nil {
		return SlowLogData{}, err
	}

	if limit <= 0 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	client := entry.client(0)
	logs, err := client.SlowLogGet(ctx, int64(limit)).Result()
	if err != nil {
		return SlowLogData{}, err
	}

	data := SlowLogData{
		Entries:     buildSlowQueries(logs),
		ThresholdMs: 10,
	}
	if total, countErr := client.SlowLogLen(ctx).Result(); countErr == nil {
		data.Total = total
	}
	if config, configErr := client.ConfigGet(ctx, "slowlog-log-slower-than").Result(); configErr == nil {
		if raw, ok := config["slowlog-log-slower-than"]; ok {
			if micros, parseErr := strconv.ParseInt(raw, 10, 64); parseErr == nil {
				data.ThresholdMs = float64(micros) / 1000
			}
		}
	}
	if config, configErr := client.ConfigGet(ctx, "slowlog-max-len").Result(); configErr == nil {
		if raw, ok := config["slowlog-max-len"]; ok {
			if maxLen, parseErr := strconv.ParseInt(raw, 10, 64); parseErr == nil {
				data.MaxLen = maxLen
			}
		}
	}

	return data, nil
}

// ClearSlowLog 清空当前实例的慢查询日志。
func (s *RedisService) ClearSlowLog(connectionID string) error {
	entry, err := s.entry(connectionID)
	if err != nil {
		return err
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	return entry.client(0).SlowLogReset(ctx).Err()
}

// GetInstanceStatus 读取 INFO 并返回结构化的实例状态。
func (s *RedisService) GetInstanceStatus(id string) (InstanceStatus, error) {
	entry, err := s.entry(id)
	if err != nil {
		return InstanceStatus{}, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	client := entry.client(0)
	info, err := client.Info(ctx, "all").Result()
	if err != nil {
		return InstanceStatus{}, err
	}

	status := parseInstanceStatus(info, client.Options().Addr)
	status.Name = entry.cfg.Name
	if status.Name == "" {
		status.Name = status.Address
	}

	if logs, logErr := client.SlowLogGet(ctx, 5).Result(); logErr == nil {
		status.SlowQueries = buildSlowQueries(logs)
	}
	if count, countErr := client.SlowLogLen(ctx).Result(); countErr == nil {
		status.SlowlogCount = count
	}

	status.SlowlogThresholdMs = 10
	if config, configErr := client.ConfigGet(ctx, "slowlog-log-slower-than").Result(); configErr == nil {
		if raw, ok := config["slowlog-log-slower-than"]; ok {
			if micros, parseErr := strconv.ParseInt(raw, 10, 64); parseErr == nil {
				status.SlowlogThresholdMs = float64(micros) / 1000
			}
		}
	}

	return status, nil
}

func parseInstanceStatus(raw string, address string) InstanceStatus {
	values := parseInfoMap(raw)

	status := InstanceStatus{
		Address:      address,
		Version:      values["redis_version"],
		Mode:         values["redis_mode"],
		Role:         values["role"],
		OS:           values["os"],
		ArchBits:     values["arch_bits"],
		ProcessID:    infoInt(values, "process_id"),
		UptimeSecond: infoInt(values, "uptime_in_seconds"),

		UsedMemory:          infoInt(values, "used_memory"),
		UsedMemoryHuman:     values["used_memory_human"],
		UsedMemoryPeakHuman: values["used_memory_peak_human"],
		UsedMemoryRSSHuman:  values["used_memory_rss_human"],
		MemoryFragmentation: infoFloat(values, "mem_fragmentation_ratio"),
		MaxMemory:           infoInt(values, "maxmemory"),

		MaxClients:               infoInt(values, "maxclients"),
		ConnectedClients:         infoInt(values, "connected_clients"),
		BlockedClients:           infoInt(values, "blocked_clients"),
		TotalConnectionsReceived: infoInt(values, "total_connections_received"),
		TotalCommandsProcessed:   infoInt(values, "total_commands_processed"),
		InstantaneousOpsPerSec:   infoInt(values, "instantaneous_ops_per_sec"),

		KeyspaceHits:        infoInt(values, "keyspace_hits"),
		KeyspaceMisses:      infoInt(values, "keyspace_misses"),
		ExpiredKeys:         infoInt(values, "expired_keys"),
		EvictedKeys:         infoInt(values, "evicted_keys"),
		RejectedConnections: infoInt(values, "rejected_connections"),

		RDBLastSaveTime: infoInt(values, "rdb_last_save_time"),
		RDBInProgress:   values["rdb_bgsave_in_progress"] == "1",
		AOFEnabled:      values["aof_enabled"] == "1",
		AOFLastWrite:    values["aof_last_write_status"],
		AOFCurrentSize:  infoInt(values, "aof_current_size"),

		ConnectedSlaves:  infoInt(values, "connected_slaves"),
		MaxReplicaLag:    maxReplicaLag(values),
		MasterHost:       values["master_host"],
		MasterPort:       infoInt(values, "master_port"),
		MasterLinkStatus: values["master_link_status"],

		Databases: parseDatabases(values),
	}

	status.Commands, status.CommandTotalCalls = parseCommandStats(values)

	if status.AOFLastWrite == "" {
		status.AOFLastWrite = values["aof_last_bgrewrite_status"]
	}

	total := status.KeyspaceHits + status.KeyspaceMisses
	if total > 0 {
		status.HitRate = float64(status.KeyspaceHits) / float64(total) * 100
	}

	return status
}

func parseInfoMap(raw string) map[string]string {
	values := make(map[string]string)
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		index := strings.Index(line, ":")
		if index <= 0 {
			continue
		}
		values[line[:index]] = strings.TrimSpace(line[index+1:])
	}
	return values
}

func parseDatabases(values map[string]string) []DatabaseStatus {
	databases := make([]DatabaseStatus, 0)

	for key, value := range values {
		if !strings.HasPrefix(key, "db") || len(key) <= 2 {
			continue
		}
		index, err := strconv.Atoi(key[2:])
		if err != nil {
			continue
		}

		fields := parseKV(value)

		databases = append(databases, DatabaseStatus{
			Index:   index,
			Keys:    infoInt(fields, "keys"),
			Expires: infoInt(fields, "expires"),
			AvgTTL:  infoInt(fields, "avg_ttl"),
		})
	}

	sort.Slice(databases, func(i, j int) bool {
		return databases[i].Index < databases[j].Index
	})
	return databases
}

func parseKV(value string) map[string]string {
	fields := make(map[string]string)
	for _, part := range strings.Split(value, ",") {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) == 2 {
			fields[kv[0]] = kv[1]
		}
	}
	return fields
}

func parseCommandStats(values map[string]string) ([]CommandStat, int64) {
	stats := make([]CommandStat, 0)
	var total int64

	for key, value := range values {
		if !strings.HasPrefix(key, "cmdstat_") {
			continue
		}
		calls := infoInt(parseKV(value), "calls")
		if calls <= 0 {
			continue
		}
		total += calls
		stats = append(stats, CommandStat{
			Name:  strings.ToUpper(strings.ReplaceAll(strings.TrimPrefix(key, "cmdstat_"), "|", " ")),
			Calls: calls,
		})
	}

	sort.Slice(stats, func(i, j int) bool {
		if stats[i].Calls == stats[j].Calls {
			return stats[i].Name < stats[j].Name
		}
		return stats[i].Calls > stats[j].Calls
	})
	if len(stats) > 12 {
		stats = stats[:12]
	}
	return stats, total
}

func maxReplicaLag(values map[string]string) int64 {
	var maxLag int64
	for key, value := range values {
		if !strings.HasPrefix(key, "slave") {
			continue
		}
		if _, err := strconv.Atoi(strings.TrimPrefix(key, "slave")); err != nil {
			continue
		}
		lag := infoInt(parseKV(value), "lag")
		if lag > maxLag {
			maxLag = lag
		}
	}
	return maxLag
}

func buildSlowQueries(entries []redis.SlowLog) []SlowQuery {
	queries := make([]SlowQuery, 0, len(entries))
	for _, entry := range entries {
		summary := ""
		command := ""
		if len(entry.Args) > 0 {
			name := strings.ToUpper(entry.Args[0])
			summary = name
			if len(entry.Args) > 1 {
				summary += " " + truncateText(entry.Args[1], 60)
			}

			parts := make([]string, 0, len(entry.Args))
			parts = append(parts, name)
			parts = append(parts, entry.Args[1:]...)
			command = truncateText(strings.Join(parts, " "), 300)
		}
		queries = append(queries, SlowQuery{
			ID:         entry.ID,
			Time:       entry.Time.Unix(),
			DurationMs: float64(entry.Duration) / float64(time.Millisecond),
			Summary:    summary,
			Command:    command,
			ClientAddr: entry.ClientAddr,
		})
	}
	return queries
}

func truncateText(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit]) + "…"
}

func infoInt(values map[string]string, key string) int64 {
	number, _ := strconv.ParseInt(values[key], 10, 64)
	return number
}

func infoFloat(values map[string]string, key string) float64 {
	number, _ := strconv.ParseFloat(values[key], 64)
	return number
}

const (
	maxAnalysisKeys = 5000
	analysisTimeout = 30 * time.Second
)

type TypeSummary struct {
	Type   string `json:"type"`
	Keys   int64  `json:"keys"`
	Memory int64  `json:"memory"`
}

type NamespaceSummary struct {
	Namespace string   `json:"namespace"`
	Types     []string `json:"types"`
	Keys      int64    `json:"keys"`
	Memory    int64    `json:"memory"`
}

type KeyAnalysisItem struct {
	Key    string `json:"key"`
	Type   string `json:"type"`
	TTL    int64  `json:"ttl"`
	Size   int64  `json:"size"`
	Length int64  `json:"length"`
}

type KeyAnalysis struct {
	TotalKeys   int64              `json:"totalKeys"`
	TotalMemory int64              `json:"totalMemory"`
	Types       []TypeSummary      `json:"types"`
	Namespaces  []NamespaceSummary `json:"namespaces"`
	TopByMemory []KeyAnalysisItem  `json:"topByMemory"`
	TopByLength []KeyAnalysisItem  `json:"topByLength"`
	Truncated   bool               `json:"truncated"`
}

// GetKeyAnalysis 扫描当前 DB，统计各类型内存/数量、命名空间和 Top Key。
func (s *RedisService) GetKeyAnalysis(connectionID string, db int, topN int) (KeyAnalysis, error) {
	entry, err := s.entry(connectionID)
	if err != nil {
		return KeyAnalysis{}, err
	}
	if topN <= 0 {
		topN = 15
	}
	if topN > 100 {
		topN = 100
	}

	ctx, cancel := context.WithTimeout(context.Background(), analysisTimeout)
	defer cancel()

	client := entry.client(db)
	result := KeyAnalysis{
		Types:       []TypeSummary{},
		Namespaces:  []NamespaceSummary{},
		TopByMemory: []KeyAnalysisItem{},
		TopByLength: []KeyAnalysisItem{},
	}

	typeAgg := make(map[string]*TypeSummary)
	nsAgg := make(map[string]*namespaceAggregate)
	seen := make(map[string]struct{})
	items := make([]KeyAnalysisItem, 0)

	cursor := uint64(0)
	for {
		keys, next, scanErr := client.Scan(ctx, cursor, "*", 500).Result()
		if scanErr != nil {
			return KeyAnalysis{}, scanErr
		}

		if len(keys) > 0 {
			batch := analyzeKeys(ctx, client, keys)
			for _, item := range batch {
				if _, duplicate := seen[item.Key]; duplicate {
					continue
				}
				seen[item.Key] = struct{}{}
				items = append(items, item)
				result.TotalKeys++
				result.TotalMemory += item.Size

				summary := typeAgg[item.Type]
				if summary == nil {
					summary = &TypeSummary{Type: item.Type}
					typeAgg[item.Type] = summary
				}
				summary.Keys++
				summary.Memory += item.Size

				namespace := namespaceOf(item.Key)
				aggregate := nsAgg[namespace]
				if aggregate == nil {
					aggregate = &namespaceAggregate{types: make(map[string]struct{})}
					nsAgg[namespace] = aggregate
				}
				aggregate.keys++
				aggregate.memory += item.Size
				aggregate.types[item.Type] = struct{}{}
			}
		}

		cursor = next
		if cursor == 0 {
			break
		}
		if len(items) >= maxAnalysisKeys {
			result.Truncated = true
			break
		}
	}

	for _, summary := range typeAgg {
		result.Types = append(result.Types, *summary)
	}
	sort.Slice(result.Types, func(i, j int) bool {
		if result.Types[i].Memory == result.Types[j].Memory {
			if result.Types[i].Keys == result.Types[j].Keys {
				return result.Types[i].Type < result.Types[j].Type
			}
			return result.Types[i].Keys > result.Types[j].Keys
		}
		return result.Types[i].Memory > result.Types[j].Memory
	})

	for namespace, aggregate := range nsAgg {
		types := make([]string, 0, len(aggregate.types))
		for typ := range aggregate.types {
			types = append(types, typ)
		}
		sort.Strings(types)
		result.Namespaces = append(result.Namespaces, NamespaceSummary{
			Namespace: namespace,
			Types:     types,
			Keys:      aggregate.keys,
			Memory:    aggregate.memory,
		})
	}
	sort.Slice(result.Namespaces, func(i, j int) bool {
		if result.Namespaces[i].Memory == result.Namespaces[j].Memory {
			return result.Namespaces[i].Keys > result.Namespaces[j].Keys
		}
		return result.Namespaces[i].Memory > result.Namespaces[j].Memory
	})

	byMemory := append([]KeyAnalysisItem(nil), items...)
	sort.Slice(byMemory, func(i, j int) bool {
		if byMemory[i].Size == byMemory[j].Size {
			return byMemory[i].Key < byMemory[j].Key
		}
		return byMemory[i].Size > byMemory[j].Size
	})
	result.TopByMemory = truncateItems(byMemory, topN)

	byLength := append([]KeyAnalysisItem(nil), items...)
	sort.Slice(byLength, func(i, j int) bool {
		if byLength[i].Length == byLength[j].Length {
			return byLength[i].Key < byLength[j].Key
		}
		return byLength[i].Length > byLength[j].Length
	})
	result.TopByLength = truncateItems(byLength, topN)

	return result, nil
}

type namespaceAggregate struct {
	types  map[string]struct{}
	keys   int64
	memory int64
}

func namespaceOf(key string) string {
	if index := strings.Index(key, ":"); index > 0 {
		return key[:index]
	}
	return ""
}

func truncateItems(items []KeyAnalysisItem, limit int) []KeyAnalysisItem {
	if len(items) > limit {
		return items[:limit]
	}
	return items
}

func analyzeKeys(ctx context.Context, client *redis.Client, keys []string) []KeyAnalysisItem {
	items := make([]KeyAnalysisItem, len(keys))

	pipeline := client.Pipeline()
	typeCmds := make([]*redis.StatusCmd, len(keys))
	sizeCmds := make([]*redis.Cmd, len(keys))
	ttlCmds := make([]*redis.Cmd, len(keys))
	for i, key := range keys {
		typeCmds[i] = pipeline.Type(ctx, key)
		sizeCmds[i] = pipeline.Do(ctx, "MEMORY", "USAGE", key)
		ttlCmds[i] = pipeline.Do(ctx, "TTL", key)
	}
	_, _ = pipeline.Exec(ctx)

	for i, key := range keys {
		typ := typeCmds[i].Val()
		if typ == "" {
			typ = "none"
		}
		size, _ := sizeCmds[i].Int64()
		ttl, _ := ttlCmds[i].Int64()
		// 模块类型没有统一的长度命令，保持 -1 让前端显示占位符。
		items[i] = KeyAnalysisItem{Key: key, Type: typ, Size: size, TTL: ttl, Length: -1}
	}

	lengths := client.Pipeline()
	lengthCmds := make([]*redis.Cmd, len(items))
	for i, item := range items {
		switch item.Type {
		case "string":
			lengthCmds[i] = lengths.Do(ctx, "STRLEN", item.Key)
		case "list":
			lengthCmds[i] = lengths.Do(ctx, "LLEN", item.Key)
		case "set":
			lengthCmds[i] = lengths.Do(ctx, "SCARD", item.Key)
		case "zset":
			lengthCmds[i] = lengths.Do(ctx, "ZCARD", item.Key)
		case "hash":
			lengthCmds[i] = lengths.Do(ctx, "HLEN", item.Key)
		case "stream":
			lengthCmds[i] = lengths.Do(ctx, "XLEN", item.Key)
		case "ReJSON-RL", "ReJSON", "json":
			lengthCmds[i] = lengths.Do(ctx, "JSON.OBJLEN", item.Key)
		}
	}
	_, _ = lengths.Exec(ctx)

	for i := range items {
		if lengthCmds[i] == nil {
			continue
		}
		value, err := lengthCmds[i].Result()
		if err == nil {
			items[i].Length = commandInt(value)
		}
	}

	return items
}

func commandInt(value interface{}) int64 {
	switch typed := value.(type) {
	case int64:
		return typed
	case float64:
		return int64(typed)
	case []interface{}:
		if len(typed) > 0 {
			return commandInt(typed[0])
		}
	}
	return 0
}
