# 性能测试记录

## 测试环境

- macOS，Apple Silicon
- Redis 8.6.2（Docker，本机 127.0.0.1:6379）
- 应用以 Server 模式运行，Chrome 无头模式驱动界面
- 测试数据库：DB1，不包含用户数据

## 数据集

使用 `hack/loadtest` 写入 100,000 个核心键及 7 个模块键：

```bash
go run ./hack/loadtest -db 1 -count 100000
```

| 指标 | 结果 |
| --- | --- |
| 导入耗时 | 383 ms |
| 导入吞吐 | 约 261,000 keys/s |
| 写入后 DB1 键数 | 100,007 |
| Redis 内存占用 | 约 107 MiB |
| 失败命令 | 0 |

数据包含 JSON、Hash、String、ZSet、List、Set、Stream，以及 TimeSeries、Bloom、Cuckoo、CMS、TopK、TDigest、VectorSet。

## 界面性能

| 场景 | 结果 |
| --- | --- |
| 切换 DB1 并加载第一页（201 键） | 53 ms |
| 连续加载更多到 5,012 键（24 页） | 平均 50 ms/页，最大 51 ms |
| 展开全部 5,012 个键 | 284 ms |
| 选中 key 并加载值 | 157 ms |
| 本地包含筛选（5,012 键，宽匹配） | 36 ms |
| 本地包含筛选（窄匹配） | 19 ms |
| 服务器扫描第一页（稀疏模式） | 15 ms |
| 分析页（扫描全部 100,007 键） | 483 ms |
| 状态页加载 | 50 ms |
| JS 堆占用（加载 5,012 键后） | 约 51 MB |

## 后端 SCAN

直接以 `COUNT 200` 遍历 DB1 全部 100,007 个键：

| MATCH 模式 | 匹配数 | SCAN 轮次 | 耗时 |
| --- | --- | --- | --- |
| `*` | 100,007 | 500 | 103 ms |
| `perf:json:user:399*` | 111 | 500 | 63 ms |
| `perf:json:user:3999*` | 11 | 500 | 64 ms |

## 观察

- 10 万键规模下，首屏、分页、筛选、分析和状态页均在百毫秒级完成。
- 分析页会扫描当前 DB 的全部键；10 万键全量分析耗时约 483 ms，结果包含全部类型、命名空间和 Top Key。
- SCAN 的 MATCH 需要遍历完整游标空间；稀疏模式的匹配结果可能分散在大量分页中，单次“加载更多”不一定新增结果，需要继续加载直到游标结束。
- 当前列表采用一次性渲染；已加载 5,000 键时展开全部耗时约 284 ms，加载量继续增大后建议改用虚拟列表。

## 复现

```bash
go run ./hack/loadtest -db 1 -count 100000
wails3 task build:server
WAILS_SERVER_PORT=34115 ./bin/redis-studio-server
```

测试完成后可清理数据：

```bash
go run ./hack/loadtest -db 1 -clean-only
```
