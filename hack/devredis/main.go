// Command devredis 启动一个仅供本地开发调试的 miniredis 实例。
// 生产构建不会包含它。
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/alicebob/miniredis/v2"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:16379", "listen address")
	flag.Parse()

	mr := miniredis.NewMiniRedis()
	if err := mr.StartAddr(*addr); err != nil {
		log.Fatalf("start miniredis: %v", err)
	}
	defer mr.Close()

	// 预置一点数据，方便打开界面就能看到内容。
	mr.Set("greeting", "hello from miniredis")
	mr.SetTTL("greeting", time.Hour)
	mr.HSet("user:1", "name", "alice", "role", "admin")
	mr.Lpush("jobs", "second")
	mr.Lpush("jobs", "first")

	// 带命名空间的数据，用来演示树形分组。
	for i := 1; i <= 8; i++ {
		mr.Set(fmt.Sprintf("sample_bicycle:%d", 1000+i), fmt.Sprintf(`{"id":%d}`, i))
	}
	for i := 1; i <= 4; i++ {
		mr.Set(fmt.Sprintf("sample_restaurant:%d", i), fmt.Sprintf(`{"id":%d}`, i))
	}
	mr.Set("app:config", `{"debug":false}`)
	mr.HSet("app:cache:user:1", "name", "alice")
	mr.HSet("app:cache:user:2", "name", "bob")

	fmt.Printf("dev redis listening on %s\n", mr.Addr())

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	<-signals
}
