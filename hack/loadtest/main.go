// Command loadtest 向指定 Redis 数据库写入可重复生成的大批量测试数据。
// 默认写入 DB 1 的 perf:* 命名空间，不会改动其他 key。
package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const batchSize = 500

func main() {
	addr := flag.String("addr", "127.0.0.1:6379", "Redis address")
	password := flag.String("password", "", "Redis password")
	db := flag.Int("db", 1, "Redis database")
	prefix := flag.String("prefix", "perf", "key prefix owned by this tool")
	count := flag.Int("count", 50000, "number of core keys to generate")
	clean := flag.Bool("clean", true, "remove existing keys with this prefix first")
	cleanOnly := flag.Bool("clean-only", false, "remove existing test keys and exit")
	flag.Parse()

	if *count <= 0 && !*cleanOnly {
		log.Fatal("count must be positive")
	}
	if *prefix == "" {
		log.Fatal("prefix must not be empty")
	}

	ctx := context.Background()
	client := redis.NewClient(&redis.Options{
		Addr:     *addr,
		Password: *password,
		DB:       *db,
	})
	defer client.Close()

	if err := client.Ping(ctx).Err(); err != nil {
		log.Fatalf("connect %s: %v", *addr, err)
	}

	start := time.Now()
	if *clean || *cleanOnly {
		removed, err := deletePrefix(ctx, client, *prefix)
		if err != nil {
			log.Fatalf("clean prefix: %v", err)
		}
		fmt.Printf("cleaned %d existing %s:* keys\n", removed, *prefix)
	}
	if *cleanOnly {
		return
	}

	before := client.DBSize(ctx).Val()
	written, failed, err := importData(ctx, client, *prefix, *count)
	if err != nil {
		log.Fatalf("import: %v", err)
	}
	after := client.DBSize(ctx).Val()
	elapsed := time.Since(start)

	fmt.Println()
	fmt.Printf("imported: %d keys (+%d module keys), failed commands: %d\n", written, moduleKeyCount, failed)
	fmt.Printf("db%d size: %d -> %d\n", *db, before, after)
	fmt.Printf("elapsed: %s (%.0f keys/s)\n", elapsed.Round(time.Millisecond), float64(written)/elapsed.Seconds())
}

const moduleKeyCount = 7

func importData(ctx context.Context, client *redis.Client, prefix string, total int) (int, int, error) {
	jsonN := total * 40 / 100
	hashN := total * 20 / 100
	stringN := total * 15 / 100
	zsetN := total * 10 / 100
	listN := total * 6 / 100
	setN := total * 5 / 100
	streamN := total - jsonN - hashN - stringN - zsetN - listN - setN

	type plan struct {
		kind  string
		count int
	}
	plans := []plan{
		{"json", jsonN},
		{"hash", hashN},
		{"string", stringN},
		{"zset", zsetN},
		{"list", listN},
		{"set", setN},
		{"stream", streamN},
	}

	written := 0
	failed := 0
	pipe := client.Pipeline()
	queued := 0
	lastReport := time.Now()

	flush := func() error {
		if queued == 0 {
			return nil
		}
		cmds, err := pipe.Exec(ctx)
		for _, cmd := range cmds {
			if cmd.Err() != nil {
				failed++
			}
		}
		queued = 0
		return err
	}

	for _, item := range plans {
		for i := 0; i < item.count; i++ {
			switch item.kind {
			case "json":
				key := fmt.Sprintf("%s:json:user:%d", prefix, i)
				payload := fmt.Sprintf(
					`{"id":%d,"name":"user-%d","email":"user%d@example.com","active":%t,"score":%d,"tags":["alpha","beta","gamma"]}`,
					i, i, i, i%3 == 0, i%1000,
				)
				pipe.Do(ctx, "JSON.SET", key, "$", payload)
			case "hash":
				key := fmt.Sprintf("%s:hash:session:%d", prefix, i)
				pipe.HSet(ctx, key,
					"name", fmt.Sprintf("session-%d", i),
					"role", []string{"admin", "editor", "viewer"}[i%3],
					"email", fmt.Sprintf("session%d@example.com", i),
					"score", i%1000,
					"updatedAt", time.Now().Unix(),
				)
			case "string":
				key := fmt.Sprintf("%s:string:token:%d", prefix, i)
				pipe.Set(ctx, key, fmt.Sprintf("token-%08d-0123456789abcdef0123456789abcdef", i), 0)
			case "zset":
				key := fmt.Sprintf("%s:zset:leaderboard:%d", prefix, i)
				members := make([]redis.Z, 8)
				for j := range members {
					members[j] = redis.Z{
						Score:  float64((i*17 + j*31) % 10000),
						Member: fmt.Sprintf("player-%d-%d", i, j),
					}
				}
				pipe.ZAdd(ctx, key, members...)
			case "list":
				key := fmt.Sprintf("%s:list:queue:%d", prefix, i)
				values := make([]interface{}, 10)
				for j := range values {
					values[j] = fmt.Sprintf("job-%d-%d", i, j)
				}
				pipe.RPush(ctx, key, values...)
			case "set":
				key := fmt.Sprintf("%s:set:tags:%d", prefix, i)
				members := make([]interface{}, 8)
				for j := range members {
					members[j] = fmt.Sprintf("tag-%d-%d", i, j)
				}
				pipe.SAdd(ctx, key, members...)
			case "stream":
				key := fmt.Sprintf("%s:stream:events:%d", prefix, i)
				for j := 0; j < 5; j++ {
					pipe.XAdd(ctx, &redis.XAddArgs{
						Stream: key,
						Values: map[string]interface{}{
							"event": fmt.Sprintf("event-%d", j),
							"user":  fmt.Sprintf("user-%d", i),
							"value": j * 10,
						},
					})
				}
			}

			written++
			queued++
			if queued >= batchSize {
				if err := flush(); err != nil && !strings.Contains(err.Error(), "redis: nil") {
					// 单条命令失败已单独计数；只有连接级错误才中断。
					return written, failed, err
				}
				if time.Since(lastReport) >= time.Second {
					fmt.Printf("  queued %d/%d keys...\n", written, total)
					lastReport = time.Now()
				}
			}
		}
	}
	if err := flush(); err != nil && !strings.Contains(err.Error(), "redis: nil") {
		return written, failed, err
	}

	if failed == 0 {
		createModuleKeys(ctx, client, prefix)
	}
	return written, failed, nil
}

func createModuleKeys(ctx context.Context, client *redis.Client, prefix string) {
	now := time.Now().UnixMilli()
	commands := [][]interface{}{
		{"TS.CREATE", prefix + ":module:timeseries", "RETENTION", 86400000, "DUPLICATE_POLICY", "LAST", "LABELS", "source", "loadtest"},
		{"TS.ADD", prefix + ":module:timeseries", now, 21.5},
		{"TS.ADD", prefix + ":module:timeseries", now + 1000, 22.1},
		{"BF.ADD", prefix + ":module:bloom", "loadtest-user"},
		{"CF.ADD", prefix + ":module:cuckoo", "loadtest@example.com"},
		{"CMS.INITBYPROB", prefix + ":module:cms", 0.001, 0.01},
		{"CMS.INCRBY", prefix + ":module:cms", "/api/users", 100},
		{"TOPK.RESERVE", prefix + ":module:topk", 10},
		{"TOPK.ADD", prefix + ":module:topk", "redis", "golang", "react"},
		{"TDIGEST.CREATE", prefix + ":module:tdigest", "COMPRESSION", 100},
		{"TDIGEST.ADD", prefix + ":module:tdigest", 12.5, 20.1, 33.4, 41.0},
		{"VADD", prefix + ":module:vectorset", "VALUES", 3, 0.1, 0.2, 0.3, "vector-a"},
		{"VADD", prefix + ":module:vectorset", "VALUES", 3, 0.4, 0.5, 0.6, "vector-b"},
	}
	for _, command := range commands {
		if err := client.Do(ctx, command...).Err(); err != nil {
			fmt.Printf("  module command %v skipped: %v\n", command[0], err)
		}
	}
}

func deletePrefix(ctx context.Context, client *redis.Client, prefix string) (int, error) {
	var cursor uint64
	removed := 0
	for {
		keys, next, err := client.Scan(ctx, cursor, prefix+":*", 1000).Result()
		if err != nil {
			return removed, err
		}
		if len(keys) > 0 {
			if err := client.Unlink(ctx, keys...).Err(); err != nil {
				return removed, err
			}
			removed += len(keys)
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
	return removed, nil
}
