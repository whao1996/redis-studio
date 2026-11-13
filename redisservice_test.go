package main

import (
	"net"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func startService(t *testing.T) (*RedisService, *miniredis.Miniredis, string) {
	t.Helper()

	mr := miniredis.RunT(t)
	host, portText, err := net.SplitHostPort(mr.Addr())
	if err != nil {
		t.Fatalf("split addr: %v", err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatalf("parse port: %v", err)
	}

	svc := NewRedisServiceWithConfigPath(filepath.Join(t.TempDir(), "connections.json"))
	info, err := svc.Connect(ConnectionConfig{Name: "test", Host: host, Port: port})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	t.Cleanup(func() { _ = svc.Disconnect(info.ID) })

	return svc, mr, info.ID
}

func TestStringLifecycle(t *testing.T) {
	svc, _, id := startService(t)

	if err := svc.SetString(id, 0, "greeting", "hello redis", 120); err != nil {
		t.Fatalf("set string: %v", err)
	}

	scan, err := svc.ScanKeys(id, 0, "0", "*", 100)
	if err != nil {
		t.Fatalf("scan: %v", err)
	}
	if len(scan.Keys) != 1 || scan.Keys[0].Key != "greeting" {
		t.Fatalf("unexpected scan result: %+v", scan.Keys)
	}
	if scan.Keys[0].Type != "string" {
		t.Fatalf("expected string type, got %q", scan.Keys[0].Type)
	}
	if scan.Keys[0].TTL <= 0 || scan.Keys[0].TTL > 120 {
		t.Fatalf("expected positive ttl <= 120, got %d", scan.Keys[0].TTL)
	}

	value, err := svc.GetValue(id, 0, "greeting")
	if err != nil {
		t.Fatalf("get value: %v", err)
	}
	if value.Value != "hello redis" || !value.Editable {
		t.Fatalf("unexpected value result: %+v", value)
	}

	if err := svc.DeleteKey(id, 0, "greeting"); err != nil {
		t.Fatalf("delete key: %v", err)
	}
	if _, err := svc.GetValue(id, 0, "greeting"); err == nil {
		t.Fatal("expected error for deleted key")
	}
}

func TestScanAllKeys(t *testing.T) {
	svc, mr, id := startService(t)
	mr.Set("a:1", "one")
	mr.Set("a:2", "two")
	mr.HSet("b:1", "field", "value")

	all, err := svc.ScanAllKeys(id, 0, "*")
	if err != nil {
		t.Fatalf("scan all: %v", err)
	}
	if len(all.Keys) != 3 {
		t.Fatalf("expected 3 keys, got %+v", all.Keys)
	}
	if all.HasMore || all.Cursor != "0" {
		t.Fatalf("unexpected scan all result: %+v", all)
	}
}

func TestCollectionValues(t *testing.T) {
	svc, mr, id := startService(t)

	mr.HSet("user:1", "name", "alice", "role", "admin")
	hash, err := svc.GetValue(id, 0, "user:1")
	if err != nil {
		t.Fatalf("get hash: %v", err)
	}
	if hash.Type != "hash" || hash.Length != 2 || len(hash.Entries) != 2 {
		t.Fatalf("unexpected hash result: %+v", hash)
	}
	if hash.Entries[0].Field != "name" || hash.Entries[0].Value != "alice" {
		t.Fatalf("hash entries not sorted as expected: %+v", hash.Entries)
	}
	if hash.Editable {
		t.Fatal("collection values should be read-only")
	}

	mr.Lpush("jobs", "second")
	mr.Lpush("jobs", "first")
	list, err := svc.GetValue(id, 0, "jobs")
	if err != nil {
		t.Fatalf("get list: %v", err)
	}
	if list.Type != "list" || list.Length != 2 {
		t.Fatalf("unexpected list result: %+v", list)
	}

	if err := svc.SetString(id, 0, "jobs", "oops", 0); err == nil {
		t.Fatal("expected type guard error when overwriting a list as string")
	}
}

func TestPrettyJSON(t *testing.T) {
	input := `{"b":12345678901234567890,"a":[1,true,null,"x"]}`
	got, err := prettyJSON(input)
	if err != nil {
		t.Fatalf("prettyJSON: %v", err)
	}

	want := "{\n  \"b\": 12345678901234567890,\n  \"a\": [\n    1,\n    true,\n    null,\n    \"x\"\n  ]\n}"
	if got != want {
		t.Fatalf("unexpected formatting:\n got: %q\nwant: %q", got, want)
	}

	if _, err := prettyJSON(`{"broken":`); err == nil {
		t.Fatal("expected error for invalid json")
	}
}

func TestModuleHelpers(t *testing.T) {
	info := moduleInfo(map[interface{}]interface{}{
		"k":      5,
		"width":  8,
		"depth":  7,
		"decay":  0.9,
		"labels": map[interface{}]interface{}{"sensor": "room-a", "floor": 2},
		"rules":  map[interface{}]interface{}{},
	}, []string{"k", "width", "depth", "decay"})

	wantOrder := []string{"k", "width", "depth", "decay", "labels"}
	if len(info) != len(wantOrder) {
		t.Fatalf("unexpected info entries: %+v", info)
	}
	for i, name := range wantOrder {
		if info[i].Field != name {
			t.Fatalf("entry %d: want field %q, got %q", i, name, info[i].Field)
		}
	}
	if info[0].Value != "5" || info[3].Value != "0.9" {
		t.Fatalf("unexpected numeric formatting: %+v", info)
	}
	if info[4].Value != "floor=2, sensor=room-a" {
		t.Fatalf("unexpected nested map formatting: %q", info[4].Value)
	}

	samples := tsEntries([]interface{}{
		[]interface{}{int64(1700000000000), 21.5},
		[]interface{}{int64(1700000001000), 22.1},
	})
	if len(samples) != 2 || samples[0].Value != "21.5" {
		t.Fatalf("unexpected ts entries: %+v", samples)
	}
	if !containsDigit(samples[0].Field) {
		t.Fatalf("expected formatted timestamp, got %q", samples[0].Field)
	}

	vector := formatVector([]interface{}{0.09921259, 0.2, 0.30000001})
	if vector != "[0.0992, 0.2000, 0.3000]" {
		t.Fatalf("unexpected vector formatting: %q", vector)
	}

	if got := firstNumber([]interface{}{33.4}); got != "33.4" {
		t.Fatalf("unexpected first number: %q", got)
	}
}

func containsDigit(text string) bool {
	for _, r := range text {
		if r >= '0' && r <= '9' {
			return true
		}
	}
	return false
}

func TestEditNativeTypes(t *testing.T) {
	svc, _, id := startService(t)

	edit := func(req EditRequest) {
		t.Helper()
		req.ID = id
		req.DB = 0
		if err := svc.Edit(req); err != nil {
			t.Fatalf("edit %s: %v", req.Action, err)
		}
	}

	// Hash：新增、修改、删除。
	edit(EditRequest{Key: "h1", Action: "hash.set", Field: "name", Value: "alice"})
	edit(EditRequest{Key: "h1", Action: "hash.set", Field: "role", Value: "admin"})
	edit(EditRequest{Key: "h1", Action: "hash.set", Field: "name", Value: "bob"})
	hash, err := svc.GetValue(id, 0, "h1")
	if err != nil {
		t.Fatalf("get hash: %v", err)
	}
	if len(hash.Entries) != 2 || hash.Entries[0].Value != "bob" {
		t.Fatalf("unexpected hash after edit: %+v", hash.Entries)
	}
	edit(EditRequest{Key: "h1", Action: "hash.del", Field: "role"})

	// List：追加、按下标修改、按下标删除。
	edit(EditRequest{Key: "l1", Action: "list.push", Value: "a"})
	edit(EditRequest{Key: "l1", Action: "list.push", Value: "b"})
	edit(EditRequest{Key: "l1", Action: "list.set", Index: 0, Value: "A"})
	edit(EditRequest{Key: "l1", Action: "list.del", Index: 1})
	list, err := svc.GetValue(id, 0, "l1")
	if err != nil {
		t.Fatalf("get list: %v", err)
	}
	if len(list.Entries) != 1 || list.Entries[0].Value != "A" {
		t.Fatalf("unexpected list after edit: %+v", list.Entries)
	}

	// Set：新增、删除。
	edit(EditRequest{Key: "s1", Action: "set.add", Field: "x"})
	edit(EditRequest{Key: "s1", Action: "set.add", Field: "y"})
	edit(EditRequest{Key: "s1", Action: "set.del", Field: "x"})
	setValue, err := svc.GetValue(id, 0, "s1")
	if err != nil {
		t.Fatalf("get set: %v", err)
	}
	if len(setValue.Entries) != 1 || setValue.Entries[0].Value != "y" {
		t.Fatalf("unexpected set after edit: %+v", setValue.Entries)
	}

	// ZSet：按分数降序展示，新增、改分、删除。
	edit(EditRequest{Key: "z1", Action: "zset.set", Field: "alice", Score: 10})
	edit(EditRequest{Key: "z1", Action: "zset.set", Field: "bob", Score: 20})
	edit(EditRequest{Key: "z1", Action: "zset.set", Field: "carol", Score: 5})
	zset, err := svc.GetValue(id, 0, "z1")
	if err != nil {
		t.Fatalf("get zset: %v", err)
	}
	if len(zset.Entries) != 3 ||
		zset.Entries[0].Field != "bob" || zset.Entries[0].Value != "20" ||
		zset.Entries[1].Field != "alice" || zset.Entries[2].Field != "carol" {
		t.Fatalf("expected descending zset order, got: %+v", zset.Entries)
	}
	edit(EditRequest{Key: "z1", Action: "zset.set", Field: "alice", Score: 30})
	edit(EditRequest{Key: "z1", Action: "zset.del", Field: "bob"})
	zset, err = svc.GetValue(id, 0, "z1")
	if err != nil {
		t.Fatalf("get zset: %v", err)
	}
	if len(zset.Entries) != 2 || zset.Entries[0].Field != "alice" || zset.Entries[0].Value != "30" || zset.Entries[1].Field != "carol" {
		t.Fatalf("unexpected zset after edit: %+v", zset.Entries)
	}

	// 非法输入。
	badJSON := EditRequest{ID: id, Key: "j1", Action: "json.set", Value: "{bad"}
	if err := svc.Edit(badJSON); err == nil {
		t.Fatal("expected invalid json error")
	}
	unknown := EditRequest{ID: id, Key: "k1", Action: "nope"}
	if err := svc.Edit(unknown); err == nil {
		t.Fatal("expected unsupported action error")
	}
}

func TestCreateKey(t *testing.T) {
	svc, _, id := startService(t)

	create := func(req CreateKeyRequest) error {
		req.ID = id
		req.DB = 0
		return svc.CreateKey(req)
	}

	if err := create(CreateKeyRequest{Key: "new:string", Type: "string", Value: "hello", TTL: 120}); err != nil {
		t.Fatalf("create string: %v", err)
	}
	stringValue, err := svc.GetValue(id, 0, "new:string")
	if err != nil {
		t.Fatalf("get created string: %v", err)
	}
	if stringValue.Value != "hello" || stringValue.TTL <= 0 {
		t.Fatalf("unexpected created string: %+v", stringValue)
	}
	if err := create(CreateKeyRequest{Key: "new:string", Type: "string", Value: "x"}); err == nil {
		t.Fatal("expected duplicate key error")
	}

	if err := create(CreateKeyRequest{Key: "new:hash", Type: "hash", Items: []CreateKeyItem{
		{Field: "name", Value: "alice"},
		{Field: "role", Value: "admin"},
	}}); err != nil {
		t.Fatalf("create hash: %v", err)
	}
	hash, err := svc.GetValue(id, 0, "new:hash")
	if err != nil {
		t.Fatalf("get created hash: %v", err)
	}
	if len(hash.Entries) != 2 {
		t.Fatalf("expected 2 hash fields, got %+v", hash.Entries)
	}

	if err := create(CreateKeyRequest{Key: "new:list", Type: "list", Items: []CreateKeyItem{
		{Value: "job-1"}, {Value: "job-2"}, {Value: "job-3"},
	}}); err != nil {
		t.Fatalf("create list: %v", err)
	}
	list, err := svc.GetValue(id, 0, "new:list")
	if err != nil {
		t.Fatalf("get created list: %v", err)
	}
	if len(list.Entries) != 3 || list.Entries[2].Value != "job-3" {
		t.Fatalf("unexpected created list: %+v", list.Entries)
	}

	if err := create(CreateKeyRequest{Key: "new:set", Type: "set", Items: []CreateKeyItem{
		{Value: "redis"}, {Value: "cache"},
	}}); err != nil {
		t.Fatalf("create set: %v", err)
	}
	setValue, err := svc.GetValue(id, 0, "new:set")
	if err != nil {
		t.Fatalf("get created set: %v", err)
	}
	if len(setValue.Entries) != 2 {
		t.Fatalf("expected 2 set members, got %+v", setValue.Entries)
	}

	if err := create(CreateKeyRequest{Key: "new:zset", Type: "zset", Items: []CreateKeyItem{
		{Field: "alice", Score: 42},
		{Field: "bob", Score: 60},
	}}); err != nil {
		t.Fatalf("create zset: %v", err)
	}
	if err := create(CreateKeyRequest{Key: "new:stream", Type: "stream", Items: []CreateKeyItem{
		{Value: `{"level":"info"}`},
		{Value: `{"level":"warn"}`},
	}}); err != nil {
		t.Fatalf("create stream: %v", err)
	}
	stream, err := svc.GetValue(id, 0, "new:stream")
	if err != nil {
		t.Fatalf("get created stream: %v", err)
	}
	if len(stream.Entries) != 2 {
		t.Fatalf("expected 2 stream messages, got %+v", stream.Entries)
	}

	zset, err := svc.GetValue(id, 0, "new:zset")
	if err != nil {
		t.Fatalf("get created zset: %v", err)
	}
	if len(zset.Entries) != 2 || zset.Entries[0].Field != "bob" || zset.Entries[0].Value != "60" {
		t.Fatalf("unexpected created zset: %+v", zset.Entries)
	}

	if err := create(CreateKeyRequest{Key: "bad:json", Type: "ReJSON-RL", Value: "{bad"}); err == nil {
		t.Fatal("expected invalid json error")
	}
	if err := create(CreateKeyRequest{Key: "bad:type", Type: "unknown", Value: "x"}); err == nil {
		t.Fatal("expected unsupported type error")
	}
}

func TestParseVectorValues(t *testing.T) {
	values, err := parseVectorValues("0.1, 0.2 0.3;0.4")
	if err != nil {
		t.Fatalf("parse vector: %v", err)
	}
	if len(values) != 4 || values[2] != 0.3 {
		t.Fatalf("unexpected vector: %v", values)
	}

	if _, err := parseVectorValues("1,x"); err == nil {
		t.Fatal("expected invalid number error")
	}
	if _, err := parseVectorValues("  "); err == nil {
		t.Fatal("expected empty vector error")
	}
}

func TestConnectionProfilePersistence(t *testing.T) {
	mr := miniredis.RunT(t)
	host, portText, err := net.SplitHostPort(mr.Addr())
	if err != nil {
		t.Fatalf("split addr: %v", err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatalf("parse port: %v", err)
	}

	path := filepath.Join(t.TempDir(), "connections.json")
	svc := NewRedisServiceWithConfigPath(path)
	info, err := svc.Connect(ConnectionConfig{Name: "saved", Group: " Production ", Host: host, Port: port, DB: 0})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}

	saved := svc.ListSavedConnections()
	if len(saved) != 1 {
		t.Fatalf("expected 1 saved connection, got %+v", saved)
	}
	if saved[0].ID != info.ID || saved[0].Name != "saved" || saved[0].Group != "Production" || saved[0].Host != host || saved[0].Port != port {
		t.Fatalf("unexpected saved profile: %+v", saved[0])
	}

	if err := svc.Disconnect(info.ID); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	if again := svc.ListSavedConnections(); len(again) != 1 {
		t.Fatalf("profile should survive disconnect, got %+v", again)
	}

	svc2 := NewRedisServiceWithConfigPath(path)
	reloaded := svc2.ListSavedConnections()
	if len(reloaded) != 1 || reloaded[0].ID != info.ID {
		t.Fatalf("profile not reloaded from disk: %+v", reloaded)
	}

	profile := reloaded[0]
	info2, err := svc2.Connect(ConnectionConfig{
		ProfileID: profile.ID,
		Name:      profile.Name,
		Group:     profile.Group,
		Host:      profile.Host,
		Port:      profile.Port,
		DB:        profile.DB,
	})
	if err != nil {
		t.Fatalf("reconnect saved profile: %v", err)
	}
	if info2.ID != profile.ID {
		t.Fatalf("expected profile id %q, got %q", profile.ID, info2.ID)
	}
	if reconnected := svc2.ListSavedConnections(); len(reconnected) != 1 || reconnected[0].Group != "Production" {
		t.Fatalf("group should survive reconnect: %+v", reconnected)
	}

	if err := svc2.DeleteSavedConnection(profile.ID); err != nil {
		t.Fatalf("delete saved connection: %v", err)
	}
	if remaining := svc2.ListSavedConnections(); len(remaining) != 0 {
		t.Fatalf("expected no saved connections, got %+v", remaining)
	}
	if _, err := svc2.ScanKeys(profile.ID, 0, "0", "*", 10); err == nil {
		t.Fatal("expected error after deleting active saved connection")
	}
}

func TestParseInstanceStatus(t *testing.T) {
	raw := `# Server
redis_version:8.6.2
redis_mode:standalone
os:Linux 7.0
arch_bits:64
process_id:1
uptime_in_seconds:93784
role:master

# Clients
connected_clients:3
blocked_clients:1
maxclients:10000
total_connections_received:20
total_commands_processed:1234
instantaneous_ops_per_sec:7

# Memory
used_memory:6543210
used_memory_human:1.25M
used_memory_peak_human:2.00M
used_memory_rss_human:3.10M
mem_fragmentation_ratio:1.23
maxmemory:0

# Persistence
rdb_last_save_time:1700000000
rdb_bgsave_in_progress:0
aof_enabled:1
aof_last_write_status:ok
aof_current_size:1048576

# Replication
connected_slaves:2
slave0:ip=10.0.0.2,port=6379,state=online,offset=100,lag=1
slave1:ip=10.0.0.3,port=6379,state=online,offset=100,lag=3
master_link_status:up

# Stats
keyspace_hits:30
keyspace_misses:10
expired_keys:4
evicted_keys:2
rejected_connections:1
cmdstat_get:calls=6000,usec=60000,usec_per_call=10,rejected_calls=0,failed_calls=0
cmdstat_set:calls=3000,usec=30000,usec_per_call=10,rejected_calls=0,failed_calls=0
cmdstat_hgetall:calls=500,usec=5000,usec_per_call=10,rejected_calls=0,failed_calls=0

# Keyspace
db0:keys=10,expires=2,avg_ttl=5000
db2:keys=3,expires=0,avg_ttl=0
`

	status := parseInstanceStatus(raw, "127.0.0.1:6379")
	if status.Version != "8.6.2" || status.Mode != "standalone" || status.Role != "master" {
		t.Fatalf("unexpected server fields: %+v", status)
	}
	if status.UsedMemoryHuman != "1.25M" || status.MaxMemory != 0 || status.MemoryFragmentation != 1.23 {
		t.Fatalf("unexpected memory fields: %+v", status)
	}
	if status.ConnectedClients != 3 || status.BlockedClients != 1 || status.InstantaneousOpsPerSec != 7 {
		t.Fatalf("unexpected client fields: %+v", status)
	}
	if status.MaxClients != 10000 || status.UsedMemory != 6543210 || status.AOFCurrentSize != 1048576 {
		t.Fatalf("unexpected capacity fields: %+v", status)
	}
	if status.HitRate != 75 || status.ExpiredKeys != 4 || status.EvictedKeys != 2 {
		t.Fatalf("unexpected stats: %+v", status)
	}
	if !status.AOFEnabled || status.RDBInProgress || status.ConnectedSlaves != 2 || status.MaxReplicaLag != 3 || status.MasterLinkStatus != "up" {
		t.Fatalf("unexpected persistence/replication fields: %+v", status)
	}
	if len(status.Commands) != 3 || status.Commands[0].Name != "GET" || status.Commands[0].Calls != 6000 ||
		status.CommandTotalCalls != 9500 {
		t.Fatalf("unexpected command stats: %+v total=%d", status.Commands, status.CommandTotalCalls)
	}
	if len(status.Databases) != 2 || status.Databases[0].Index != 0 || status.Databases[0].Keys != 10 ||
		status.Databases[1].Index != 2 || status.Databases[1].Keys != 3 {
		t.Fatalf("unexpected databases: %+v", status.Databases)
	}
}

func TestBuildSlowQueries(t *testing.T) {
	logs := []redis.SlowLog{
		{
			ID:         7,
			Time:       time.Unix(1700000000, 0),
			Duration:   12400 * time.Microsecond,
			Args:       []string{"get", "user:profile:8812"},
			ClientAddr: "127.0.0.1:5000",
		},
		{
			ID:         6,
			Time:       time.Unix(1699999999, 0),
			Duration:   186000 * time.Microsecond,
			Args:       []string{"keys", "session:*"},
			ClientAddr: "127.0.0.1:5000",
		},
	}

	queries := buildSlowQueries(logs)
	if len(queries) != 2 {
		t.Fatalf("expected 2 slow queries, got %+v", queries)
	}
	if queries[0].Summary != "GET user:profile:8812" || queries[0].DurationMs != 12.4 {
		t.Fatalf("unexpected slow query: %+v", queries[0])
	}
	if queries[0].Command != "GET user:profile:8812" || queries[0].ClientAddr != "127.0.0.1:5000" {
		t.Fatalf("unexpected slow query details: %+v", queries[0])
	}
	if queries[1].Summary != "KEYS session:*" || queries[1].DurationMs != 186 {
		t.Fatalf("unexpected slow query: %+v", queries[1])
	}
}

func TestSplitCommandLine(t *testing.T) {
	args, err := splitCommandLine(`SET "hello world" 'a b' plain\ value ""`)
	if err != nil {
		t.Fatalf("split: %v", err)
	}
	if len(args) != 5 || args[0] != "SET" || args[1] != "hello world" || args[2] != "a b" || args[3] != "plain value" || args[4] != "" {
		t.Fatalf("unexpected args: %#v", args)
	}

	args, err = splitCommandLine(`SET key "a \"quoted\" value"`)
	if err != nil {
		t.Fatalf("split escaped: %v", err)
	}
	if args[2] != `a "quoted" value` {
		t.Fatalf("unexpected escaped arg: %#v", args)
	}

	if _, err := splitCommandLine(`GET "unclosed`); err == nil {
		t.Fatal("expected unclosed quote error")
	}
}

func TestExecuteCommand(t *testing.T) {
	svc, _, id := startService(t)

	result, err := svc.ExecuteCommand(id, 0, `SET greeting "hello world"`)
	if err != nil {
		t.Fatalf("execute set: %v", err)
	}
	if result.IsError || result.Display != "OK" {
		t.Fatalf("unexpected set result: %+v", result)
	}

	result, err = svc.ExecuteCommand(id, 0, `GET greeting`)
	if err != nil {
		t.Fatalf("execute get: %v", err)
	}
	if result.Display != "hello world" {
		t.Fatalf("unexpected get result: %+v", result)
	}

	result, err = svc.ExecuteCommand(id, 0, `GET missing`)
	if err != nil {
		t.Fatalf("execute missing: %v", err)
	}
	if result.Display != "(nil)" || result.IsError {
		t.Fatalf("unexpected nil result: %+v", result)
	}

	result, err = svc.ExecuteCommand(id, 0, `RPUSH list a b c`)
	if err != nil {
		t.Fatalf("execute rpush: %v", err)
	}
	if result.Display != "(integer) 3" {
		t.Fatalf("unexpected rpush result: %+v", result)
	}

	result, err = svc.ExecuteCommand(id, 0, `LRANGE list 0 -1`)
	if err != nil {
		t.Fatalf("execute lrange: %v", err)
	}
	if !strings.Contains(result.Display, "1) a") || !strings.Contains(result.Display, "3) c") {
		t.Fatalf("unexpected lrange result: %q", result.Display)
	}

	for command, code := range map[string]string{
		`SELECT 1`:      "selectNotAllowed",
		`SUBSCRIBE a`:   "blockingNotAllowed",
		`MULTI`:         "transactionNotAllowed",
		`GET "unclosed`: "invalidCommandLine",
		`   `:           "emptyCommand",
	} {
		result, err := svc.ExecuteCommand(id, 0, command)
		if err != nil {
			t.Fatalf("execute %q: %v", command, err)
		}
		if result.ErrorCode != code {
			t.Fatalf("command %q: expected code %q, got %+v", command, code, result)
		}
	}
}

func TestUpdateSavedConnection(t *testing.T) {
	mr := miniredis.RunT(t)
	host, portText, err := net.SplitHostPort(mr.Addr())
	if err != nil {
		t.Fatalf("split addr: %v", err)
	}
	port, err := strconv.Atoi(portText)
	if err != nil {
		t.Fatalf("parse port: %v", err)
	}

	path := filepath.Join(t.TempDir(), "connections.json")
	svc := NewRedisServiceWithConfigPath(path)
	info, err := svc.Connect(ConnectionConfig{Name: "old", Host: host, Port: port})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}

	if err := svc.UpdateSavedConnection(ConnectionProfile{ID: info.ID, Name: "active", Host: host, Port: port}); err == nil {
		t.Fatal("expected error while connection is active")
	}

	if err := svc.Disconnect(info.ID); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	if err := svc.UpdateSavedConnection(ConnectionProfile{
		ID:       info.ID,
		Name:     "updated",
		Group:    " Staging ",
		Host:     host,
		Port:     port,
		Password: "secret",
		DB:       2,
		UseTLS:   true,
	}); err != nil {
		t.Fatalf("update: %v", err)
	}

	reloaded := NewRedisServiceWithConfigPath(path).ListSavedConnections()
	if len(reloaded) != 1 {
		t.Fatalf("expected 1 saved connection, got %+v", reloaded)
	}
	profile := reloaded[0]
	if profile.Name != "updated" || profile.Group != "Staging" || profile.Password != "secret" || profile.DB != 2 || !profile.UseTLS {
		t.Fatalf("unexpected updated profile: %+v", profile)
	}

	if err := svc.UpdateSavedConnection(ConnectionProfile{ID: "missing", Host: host, Port: port}); err == nil {
		t.Fatal("expected error for unknown connection")
	}
}

func TestSetConnectionGroup(t *testing.T) {
	svc, _, id := startService(t)

	if err := svc.SetConnectionGroup(id, " Production "); err != nil {
		t.Fatalf("set group: %v", err)
	}
	saved := svc.ListSavedConnections()
	if len(saved) != 1 || saved[0].Group != "Production" {
		t.Fatalf("unexpected group after move: %+v", saved)
	}

	// 活动连接也允许调整分组。
	if err := svc.SetConnectionGroup(id, ""); err != nil {
		t.Fatalf("clear group: %v", err)
	}
	if saved := svc.ListSavedConnections(); saved[0].Group != "" {
		t.Fatalf("expected ungrouped connection: %+v", saved)
	}

	if err := svc.SetConnectionGroup("missing", "x"); err == nil {
		t.Fatal("expected error for unknown connection")
	}
}

func TestSetKeyTTL(t *testing.T) {
	svc, mr, id := startService(t)
	mr.Set("ttl:key", "value")

	if err := svc.SetKeyTTL(id, 0, "ttl:key", 120); err != nil {
		t.Fatalf("set ttl: %v", err)
	}
	value, err := svc.GetValue(id, 0, "ttl:key")
	if err != nil {
		t.Fatalf("get value: %v", err)
	}
	if value.TTL <= 0 {
		t.Fatalf("expected positive ttl, got %d", value.TTL)
	}

	if err := svc.SetKeyTTL(id, 0, "ttl:key", -1); err != nil {
		t.Fatalf("persist key: %v", err)
	}
	value, err = svc.GetValue(id, 0, "ttl:key")
	if err != nil {
		t.Fatalf("get value after persist: %v", err)
	}
	if value.TTL != -1 {
		t.Fatalf("expected no expiry after persist, got %d", value.TTL)
	}

	if err := svc.SetKeyTTL(id, 0, "ttl:key", 0); err == nil {
		t.Fatal("expected error for zero ttl")
	}
	if err := svc.SetKeyTTL(id, 0, "missing:key", 60); err == nil {
		t.Fatal("expected error for missing key")
	}
}

func TestListCommands(t *testing.T) {
	svc, _, id := startService(t)

	commands, err := svc.ListCommands(id)
	if err != nil {
		t.Skipf("miniredis does not support COMMAND: %v", err)
	}
	if len(commands) == 0 {
		t.Fatal("expected at least one command")
	}

	found := false
	for _, command := range commands {
		if command == "GET" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected GET in command list, got %d commands", len(commands))
	}
}

func TestPubSub(t *testing.T) {
	svc, _, id := startService(t)

	messages := make(chan PubSubMessage, 8)
	svc.SetEventEmitter(func(name string, payload any) {
		if name != "pubsub:message" {
			return
		}
		if message, ok := payload.(PubSubMessage); ok {
			messages <- message
		}
	})

	sub, err := svc.Subscribe(id, 0, "news", false)
	if err != nil {
		t.Fatalf("subscribe: %v", err)
	}
	if sub.ID == "" || sub.Kind != "channel" || sub.Target != "news" {
		t.Fatalf("unexpected subscription: %+v", sub)
	}

	receivers, err := svc.Publish(id, 0, "news", "hello pubsub")
	if err != nil {
		t.Fatalf("publish: %v", err)
	}
	if receivers < 1 {
		t.Fatalf("expected at least one receiver, got %d", receivers)
	}

	select {
	case message := <-messages:
		if message.Channel != "news" || message.Payload != "hello pubsub" || message.ConnectionID != id {
			t.Fatalf("unexpected message: %+v", message)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for pubsub message")
	}

	list := svc.ListSubscriptions(id)
	if len(list) != 1 || list[0].Messages < 1 {
		t.Fatalf("unexpected subscriptions: %+v", list)
	}

	if err := svc.Unsubscribe(id, sub.ID); err != nil {
		t.Fatalf("unsubscribe: %v", err)
	}
	if remaining := svc.ListSubscriptions(id); len(remaining) != 0 {
		t.Fatalf("expected no subscriptions, got %+v", remaining)
	}

	second, err := svc.Subscribe(id, 0, "news:*", true)
	if err != nil {
		t.Fatalf("psubscribe: %v", err)
	}
	if second.Kind != "pattern" {
		t.Fatalf("expected pattern subscription, got %+v", second)
	}
	if err := svc.Disconnect(id); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	if remaining := svc.ListSubscriptions(id); len(remaining) != 0 {
		t.Fatalf("subscriptions should close with connection, got %+v", remaining)
	}
}

func TestParseAppleDoubleClickAction(t *testing.T) {
	cases := map[string]string{
		"Maximize":   "maximize",
		"Fill":       "maximize",
		"Zoom":       "maximize",
		"Minimize":   "minimize",
		"None":       "none",
		"Do Nothing": "none",
		"unknown":    "maximize",
		"":           "maximize",
	}
	for input, expected := range cases {
		if got := parseAppleDoubleClickAction(input); got != expected {
			t.Fatalf("parse %q: expected %q, got %q", input, expected, got)
		}
	}
}

func TestApplyTitleBarAction(t *testing.T) {
	for action, expected := range map[string]struct {
		maximise bool
		minimise bool
	}{
		"maximize": {maximise: true},
		"minimize": {minimise: true},
		"none":     {},
	} {
		maximised := false
		minimised := false
		applyTitleBarAction(action, func() { maximised = true }, func() { minimised = true })
		if maximised != expected.maximise || minimised != expected.minimise {
			t.Fatalf("action %q: got maximise=%v minimise=%v", action, maximised, minimised)
		}
	}
}

func TestKeyAnalysis(t *testing.T) {
	svc, mr, id := startService(t)

	mr.Set("app:1", "hello")
	mr.Set("app:2", "world!!")
	mr.HSet("app:h", "field", "value")
	mr.Lpush("queue:1", "a")
	mr.Set("rootkey", "x")

	analysis, err := svc.GetKeyAnalysis(id, 0, 5)
	if err != nil {
		t.Fatalf("analysis: %v", err)
	}
	if analysis.TotalKeys != 5 {
		t.Fatalf("expected 5 keys, got %d", analysis.TotalKeys)
	}

	namespaces := make(map[string]NamespaceSummary)
	for _, namespace := range analysis.Namespaces {
		namespaces[namespace.Namespace] = namespace
	}
	if namespaces["app"].Keys != 3 || len(namespaces["app"].Types) != 2 {
		t.Fatalf("unexpected app namespace: %+v", namespaces["app"])
	}
	if namespaces["queue"].Keys != 1 {
		t.Fatalf("unexpected queue namespace: %+v", namespaces["queue"])
	}
	if namespaces[""].Keys != 1 {
		t.Fatalf("unexpected root namespace: %+v", namespaces[""])
	}

	types := make(map[string]TypeSummary)
	for _, summary := range analysis.Types {
		types[summary.Type] = summary
	}
	if types["string"].Keys != 3 || types["hash"].Keys != 1 || types["list"].Keys != 1 {
		t.Fatalf("unexpected type summary: %+v", analysis.Types)
	}

	if len(analysis.TopByLength) == 0 || analysis.TopByLength[0].Key != "app:2" || analysis.TopByLength[0].Length != 7 {
		t.Fatalf("unexpected top by length: %+v", analysis.TopByLength)
	}
}

func TestListDatabasesAndDisconnect(t *testing.T) {
	svc, _, id := startService(t)

	dbs, err := svc.ListDatabases(id)
	if err != nil {
		t.Fatalf("list databases: %v", err)
	}
	if len(dbs) == 0 {
		t.Fatal("expected at least one database")
	}

	if err := svc.Disconnect(id); err != nil {
		t.Fatalf("disconnect: %v", err)
	}
	if _, err := svc.ScanKeys(id, 0, "0", "*", 10); err == nil {
		t.Fatal("expected error after disconnect")
	}
}
