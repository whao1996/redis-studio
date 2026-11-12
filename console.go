package main

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/redis/go-redis/v9"
)

type CommandResult struct {
	Display    string  `json:"display"`
	IsError    bool    `json:"isError"`
	DurationMs float64 `json:"durationMs"`
	ErrorCode  string  `json:"errorCode"`
}

// ListCommands 返回当前实例支持的命令名（大写、排序）。
func (s *RedisService) ListCommands(id string) ([]string, error) {
	entry, err := s.entry(id)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	infos, err := entry.client(0).Command(ctx).Result()
	if err != nil {
		return nil, err
	}

	names := make([]string, 0, len(infos))
	seen := make(map[string]struct{}, len(infos))
	for _, info := range infos {
		name := strings.ToUpper(strings.TrimSpace(strings.ReplaceAll(info.Name, "|", " ")))
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		names = append(names, name)
	}

	sort.Strings(names)
	return names, nil
}

// ExecuteCommand 执行一条 Redis 命令，返回格式化后的结果。
func (s *RedisService) ExecuteCommand(id string, db int, input string) (CommandResult, error) {
	entry, err := s.entry(id)
	if err != nil {
		return CommandResult{}, err
	}

	args, parseErr := splitCommandLine(input)
	if parseErr != nil {
		return CommandResult{IsError: true, ErrorCode: "invalidCommandLine"}, nil
	}
	if len(args) == 0 {
		return CommandResult{IsError: true, ErrorCode: "emptyCommand"}, nil
	}

	command := strings.ToUpper(args[0])
	switch command {
	case "SELECT":
		return CommandResult{IsError: true, ErrorCode: "selectNotAllowed"}, nil
	case "SUBSCRIBE", "PSUBSCRIBE", "SSUBSCRIBE", "MONITOR":
		return CommandResult{IsError: true, ErrorCode: "blockingNotAllowed"}, nil
	case "MULTI", "EXEC", "DISCARD", "WATCH", "UNWATCH":
		return CommandResult{IsError: true, ErrorCode: "transactionNotAllowed"}, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	values := make([]interface{}, len(args))
	for i, arg := range args {
		values[i] = arg
	}

	start := time.Now()
	cmd := entry.client(db).Do(ctx, values...)
	duration := float64(time.Since(start)) / float64(time.Millisecond)

	if cmdErr := cmd.Err(); cmdErr != nil {
		if errors.Is(cmdErr, redis.Nil) {
			return CommandResult{Display: "(nil)", DurationMs: duration}, nil
		}
		return CommandResult{
			Display:    cmdErr.Error(),
			IsError:    true,
			DurationMs: duration,
		}, nil
	}

	value, _ := cmd.Result()
	return CommandResult{
		Display:    formatCommandValue(value),
		DurationMs: duration,
	}, nil
}

func splitCommandLine(input string) ([]string, error) {
	var args []string
	var current strings.Builder
	inSingle := false
	inDouble := false
	escaped := false
	hasToken := false

	for _, r := range input {
		if escaped {
			switch r {
			case 'n':
				current.WriteRune('\n')
			case 'r':
				current.WriteRune('\r')
			case 't':
				current.WriteRune('\t')
			default:
				current.WriteRune(r)
			}
			escaped = false
			hasToken = true
			continue
		}

		if r == '\\' && !inSingle {
			escaped = true
			hasToken = true
			continue
		}
		if r == '\'' && !inDouble {
			inSingle = !inSingle
			hasToken = true
			continue
		}
		if r == '"' && !inSingle {
			inDouble = !inDouble
			hasToken = true
			continue
		}
		if unicode.IsSpace(r) && !inSingle && !inDouble {
			if hasToken {
				args = append(args, current.String())
				current.Reset()
				hasToken = false
			}
			continue
		}

		current.WriteRune(r)
		hasToken = true
	}

	if inSingle || inDouble || escaped {
		return nil, errors.New("unclosed quote")
	}
	if hasToken {
		args = append(args, current.String())
	}
	return args, nil
}

func formatCommandValue(value interface{}) string {
	var out string
	switch v := value.(type) {
	case []interface{}:
		out = formatCommandArray(v, 0)
	case map[interface{}]interface{}:
		out = formatCommandMap(v, 0)
	case map[string]interface{}:
		out = formatCommandMap(v, 0)
	case nil:
		out = "(nil)"
	case int64:
		out = fmt.Sprintf("(integer) %d", v)
	case string:
		out = formatCommandTopString(v)
	case []byte:
		out = formatCommandTopString(string(v))
	default:
		out = fmt.Sprint(value)
	}

	const maxOutput = 64 * 1024
	if len(out) > maxOutput {
		out = out[:maxOutput] + "\n… (truncated)"
	}
	return out
}

func formatCommandArray(items []interface{}, depth int) string {
	if len(items) == 0 {
		return "(empty list or set)"
	}

	pad := strings.Repeat("  ", depth)
	var b strings.Builder
	for i, item := range items {
		if i >= 200 {
			b.WriteString(pad + "… (truncated)\n")
			break
		}
		b.WriteString(pad)
		b.WriteString(fmt.Sprintf("%d) ", i+1))
		writeCommandItem(&b, item, depth+1)
		b.WriteString("\n")
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func formatCommandMap(values interface{}, depth int) string {
	fields := make(map[string]interface{})

	switch typed := values.(type) {
	case map[interface{}]interface{}:
		for key, value := range typed {
			fields[fmt.Sprint(key)] = value
		}
	case map[string]interface{}:
		fields = typed
	}

	if len(fields) == 0 {
		return "(empty map)"
	}

	keys := make([]string, 0, len(fields))
	for key := range fields {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	pad := strings.Repeat("  ", depth)
	var b strings.Builder
	for i, key := range keys {
		if i >= 200 {
			b.WriteString(pad + "… (truncated)\n")
			break
		}
		b.WriteString(pad)
		b.WriteString(key)
		b.WriteString(" => ")
		writeCommandItem(&b, fields[key], depth+1)
		b.WriteString("\n")
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func writeCommandItem(b *strings.Builder, item interface{}, depth int) {
	switch typed := item.(type) {
	case []interface{}:
		b.WriteString("\n")
		b.WriteString(formatCommandArray(typed, depth))
	case map[interface{}]interface{}:
		b.WriteString("\n")
		b.WriteString(formatCommandMap(typed, depth))
	case map[string]interface{}:
		b.WriteString("\n")
		b.WriteString(formatCommandMap(typed, depth))
	case nil:
		b.WriteString("(nil)")
	case int64:
		b.WriteString(strconv.FormatInt(typed, 10))
	case float64:
		b.WriteString(strconv.FormatFloat(typed, 'f', -1, 64))
	case string:
		b.WriteString(formatCommandScalar(typed))
	case []byte:
		b.WriteString(formatCommandScalar(string(typed)))
	default:
		b.WriteString(fmt.Sprint(item))
	}
}

func formatCommandTopString(value string) string {
	if value == "" {
		return `""`
	}
	for _, r := range value {
		if r == '\n' || r == '\r' || r == '\t' {
			continue
		}
		if !unicode.IsPrint(r) {
			return strconv.Quote(value)
		}
	}
	return value
}

func formatCommandScalar(value string) string {
	if value == "" {
		return `""`
	}
	for _, r := range value {
		if r == '\n' || r == '\r' || r == '\t' {
			continue
		}
		if !unicode.IsPrint(r) {
			return strconv.Quote(value)
		}
	}
	if strings.ContainsAny(value, " \t") {
		return strconv.Quote(value)
	}
	return value
}
