// Command seed 向本地 Redis 写入覆盖所有常见数据结构类型的演示数据。
// 所有 key 统一使用指定前缀（默认 demo），重复执行会先清理该前缀下的旧数据。
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/redis/go-redis/v9"
)

type item struct {
	key  string
	kind string
	note string
}

type seeder struct {
	ctx      context.Context
	client   *redis.Client
	prefix   string
	items    []item
	skipped  int
	failures int
}

func main() {
	addr := flag.String("addr", "127.0.0.1:6379", "Redis address")
	password := flag.String("password", "", "Redis password")
	db := flag.Int("db", 0, "Redis database")
	prefix := flag.String("prefix", "demo", "key prefix owned by this tool")
	flag.Parse()

	*prefix = strings.TrimSpace(*prefix)
	if *prefix == "" || strings.ContainsAny(*prefix, "*?[]") {
		log.Fatal("prefix 不能为空，也不能包含通配符")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	client := redis.NewClient(&redis.Options{
		Addr:     *addr,
		Password: *password,
		DB:       *db,
	})
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		log.Fatalf("连接 %s 失败: %v", *addr, err)
	}

	before, _ := client.DBSize(ctx).Result()
	fmt.Printf("已连接 %s（Redis %s，DB %d，当前 %d 个 key）\n",
		*addr, serverVersion(ctx, client), *db, before)

	s := &seeder{ctx: ctx, client: client, prefix: *prefix}
	removed := s.clean()
	fmt.Printf("清理旧测试数据：%d 个（前缀 %s:*）\n", removed, *prefix)

	s.seedCore()
	s.seedModules()
	s.printSummary(*addr, *db)

	after, _ := client.DBSize(ctx).Result()
	fmt.Printf("DB %d 现有 %d 个 key（本次净增 %d 个）\n", *db, after, after-before)
}

func serverVersion(ctx context.Context, client *redis.Client) string {
	info, err := client.Info(ctx, "server").Result()
	if err != nil {
		return "unknown"
	}
	for _, line := range strings.Split(info, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "redis_version:") {
			return strings.TrimPrefix(line, "redis_version:")
		}
	}
	return "unknown"
}

func (s *seeder) clean() int {
	pattern := s.prefix + ":*"
	cursor := uint64(0)
	removed := 0

	for {
		keys, next, err := s.client.Scan(s.ctx, cursor, pattern, 500).Result()
		if err != nil {
			log.Fatalf("SCAN %s 失败: %v", pattern, err)
		}
		if len(keys) > 0 {
			if err := s.client.Unlink(s.ctx, keys...).Err(); err != nil {
				log.Fatalf("清理旧数据失败: %v", err)
			}
			removed += len(keys)
		}
		cursor = next
		if cursor == 0 {
			return removed
		}
	}
}

func (s *seeder) key(suffix string) string {
	return s.prefix + ":" + suffix
}

func (s *seeder) run(kind, suffix, note string, err error) {
	key := s.key(suffix)
	if err != nil {
		s.failures++
		fmt.Printf("  [fail] %-14s %-38s %v\n", kind, key, err)
		return
	}
	s.items = append(s.items, item{key: key, kind: kind, note: note})
	fmt.Printf("  [ok]   %-14s %-38s %s\n", kind, key, note)
}

func (s *seeder) optional(kind, suffix, note string, err error) {
	key := s.key(suffix)
	if err != nil {
		s.skipped++
		fmt.Printf("  [skip] %-14s %-38s %v\n", kind, key, err)
		return
	}
	s.items = append(s.items, item{key: key, kind: kind, note: note})
	fmt.Printf("  [ok]   %-14s %-38s %s\n", kind, key, note)
}

func (s *seeder) seedCore() {
	c := s.client
	ctx := s.ctx

	fmt.Println("\n[核心数据结构]")

	s.run("String", "string:greeting", "普通字符串", c.Set(ctx, s.key("string:greeting"), "hello redis", 0).Err())
	s.run("String(TTL)", "string:session", "1 小时后过期", c.Set(ctx, s.key("string:session"), "session-token-abc", time.Hour).Err())

	s.run("List", "list:queue", "RPUSH 3 个任务", c.RPush(ctx, s.key("list:queue"), "job-1", "job-2", "job-3").Err())
	s.run("Set", "set:tags", "3 个去重标签", c.SAdd(ctx, s.key("set:tags"), "redis", "database", "cache").Err())
	s.run("Hash", "hash:user:1", "name / email / age", c.HSet(ctx, s.key("hash:user:1"), map[string]any{
		"name":  "alice",
		"email": "alice@example.com",
		"age":   30,
	}).Err())

	s.run("ZSet", "zset:leaderboard", "3 位玩家分数", c.ZAdd(ctx, s.key("zset:leaderboard"),
		redis.Z{Score: 100, Member: "alice"},
		redis.Z{Score: 92, Member: "carol"},
		redis.Z{Score: 85, Member: "bob"},
	).Err())

	streamErr := c.XAdd(ctx, &redis.XAddArgs{
		Stream: s.key("stream:orders"),
		Values: map[string]any{"order_id": "1001", "amount": "99.50", "status": "paid"},
	}).Err()
	if streamErr == nil {
		streamErr = c.XAdd(ctx, &redis.XAddArgs{
			Stream: s.key("stream:orders"),
			Values: map[string]any{"order_id": "1002", "amount": "15.00", "status": "pending"},
		}).Err()
	}
	s.run("Stream", "stream:orders", "2 条订单消息", streamErr)

	bitmapErr := c.SetBit(ctx, s.key("bitmap:daily-active"), 1, 1).Err()
	if bitmapErr == nil {
		bitmapErr = c.SetBit(ctx, s.key("bitmap:daily-active"), 7, 1).Err()
	}
	if bitmapErr == nil {
		bitmapErr = c.SetBit(ctx, s.key("bitmap:daily-active"), 9, 1).Err()
	}
	if bitmapErr == nil {
		bitmapErr = c.SetBit(ctx, s.key("bitmap:daily-active"), 15, 1).Err()
	}
	s.run("Bitmap", "bitmap:daily-active", "位图，读出来是 \"AA\"", bitmapErr)

	s.run("HyperLogLog", "hll:visitors", "5 个访客 UV", c.PFAdd(ctx, s.key("hll:visitors"),
		"user-1", "user-2", "user-3", "user-4", "user-5").Err())

	s.run("Geo", "geo:stores", "3 个门店坐标", c.GeoAdd(ctx, s.key("geo:stores"),
		&redis.GeoLocation{Name: "Beijing", Longitude: 116.4074, Latitude: 39.9042},
		&redis.GeoLocation{Name: "Shanghai", Longitude: 121.4737, Latitude: 31.2304},
		&redis.GeoLocation{Name: "Shenzhen", Longitude: 114.0579, Latitude: 22.5431},
	).Err())

	product := `{"id":1001,"name":"Trail Seeker","price":369.5,"tags":["bike","mountain"],"specs":{"weight":8,"material":"titanium"},"inStock":true,"discount":null}`
	s.run("JSON", "json:product", "嵌套对象 + 数组 + null", c.Do(ctx, "JSON.SET",
		s.key("json:product"), "$", product).Err())

	order := `[{"sku":"A-1","qty":2},{"sku":"B-2","qty":1}]`
	s.run("JSON(Array)", "json:order", "顶层数组文档", c.Do(ctx, "JSON.SET",
		s.key("json:order"), "$", order).Err())
}

func (s *seeder) seedModules() {
	c := s.client
	ctx := s.ctx

	fmt.Println("\n[Redis Stack / Redis 8 模块类型]")

	tsKey := s.key("timeseries:temperature")
	tsErr := c.Do(ctx, "TS.CREATE", tsKey, "RETENTION", 86400000, "DUPLICATE_POLICY", "LAST", "LABELS", "sensor", "room-a").Err()
	now := time.Now().UnixMilli()
	if tsErr == nil {
		tsErr = c.Do(ctx, "TS.ADD", tsKey, now-60000, 21.5).Err()
	}
	if tsErr == nil {
		tsErr = c.Do(ctx, "TS.ADD", tsKey, now, 22.1).Err()
	}
	s.optional("TimeSeries", "timeseries:temperature", "2 个温度采样点", tsErr)

	bloomKey := s.key("bloom:usernames")
	bloomErr := c.Do(ctx, "BF.ADD", bloomKey, "alice").Err()
	if bloomErr == nil {
		bloomErr = c.Do(ctx, "BF.ADD", bloomKey, "bob").Err()
	}
	s.optional("Bloom", "bloom:usernames", "布隆过滤器", bloomErr)

	cuckooKey := s.key("cuckoo:emails")
	cuckooErr := c.Do(ctx, "CF.ADD", cuckooKey, "alice@example.com").Err()
	if cuckooErr == nil {
		cuckooErr = c.Do(ctx, "CF.ADD", cuckooKey, "bob@example.com").Err()
	}
	s.optional("Cuckoo", "cuckoo:emails", "布谷鸟过滤器", cuckooErr)

	cmsKey := s.key("cms:pageviews")
	cmsErr := c.Do(ctx, "CMS.INITBYPROB", cmsKey, 0.001, 0.01).Err()
	if cmsErr == nil {
		cmsErr = c.Do(ctx, "CMS.INCRBY", cmsKey, "/home", 10, "/about", 3).Err()
	}
	s.optional("CMS", "cms:pageviews", "Count-Min Sketch", cmsErr)

	topkKey := s.key("topk:searches")
	topkErr := c.Do(ctx, "TOPK.RESERVE", topkKey, 5).Err()
	if topkErr == nil {
		topkErr = c.Do(ctx, "TOPK.ADD", topkKey, "redis", "golang", "python", "java").Err()
	}
	s.optional("TopK", "topk:searches", "Top-K 排行榜", topkErr)

	tdKey := s.key("tdigest:latency")
	tdErr := c.Do(ctx, "TDIGEST.CREATE", tdKey, "COMPRESSION", 100).Err()
	if tdErr == nil {
		tdErr = c.Do(ctx, "TDIGEST.ADD", tdKey, 12.5, 20.1, 33.4, 41.0).Err()
	}
	s.optional("TDigest", "tdigest:latency", "分位数估算", tdErr)

	vecKey := s.key("vectorset:embeddings")
	vecErr := c.Do(ctx, "VADD", vecKey, "VALUES", 3, 0.1, 0.2, 0.3, "item-1").Err()
	if vecErr == nil {
		vecErr = c.Do(ctx, "VADD", vecKey, "VALUES", 3, 0.4, 0.5, 0.6, "item-2").Err()
	}
	s.optional("VectorSet", "vectorset:embeddings", "2 个 3 维向量", vecErr)
}

func (s *seeder) printSummary(addr string, db int) {
	fmt.Println("\n[写入结果]")

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "声明类型\tKEY\t实际 TYPE\t说明")
	for _, it := range s.items {
		typ, err := s.client.Type(s.ctx, it.key).Result()
		if err != nil {
			typ = "(error)"
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\n", it.kind, it.key, typ, it.note)
	}
	_ = w.Flush()

	fmt.Printf("\n完成：写入 %d 个 key，跳过 %d 个，失败 %d 个（%s / DB %d）\n",
		len(s.items), s.skipped, s.failures, addr, db)

	if s.failures > 0 {
		os.Exit(1)
	}
}
