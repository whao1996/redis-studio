package main

import (
	"context"
	"sort"
	"strings"
	"sync/atomic"
	"time"

	"github.com/redis/go-redis/v9"
)

type SubscriptionInfo struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"` // channel | pattern
	Target   string `json:"target"`
	Messages int64  `json:"messages"`
}

type PubSubMessage struct {
	ConnectionID   string `json:"connectionId"`
	SubscriptionID string `json:"subscriptionId"`
	Channel        string `json:"channel"`
	Pattern        string `json:"pattern"`
	Payload        string `json:"payload"`
	Timestamp      int64  `json:"timestamp"`
}

type subscription struct {
	info         SubscriptionInfo
	connectionID string
	pubsub       *redis.PubSub
	messages     atomic.Int64
}

func (s *RedisService) SetEventEmitter(emitter func(name string, payload any)) {
	s.eventEmitter = emitter
}

func (s *RedisService) SetTitleBarHandler(handler func()) {
	s.titleBar = handler
}

// HandleTitleBarDoubleClick 执行 macOS 标题栏双击动作（缩放或最小化）。
func (s *RedisService) HandleTitleBarDoubleClick() {
	if s.titleBar != nil {
		s.titleBar()
	}
}

// Subscribe 订阅一个频道或模式，消息通过 "pubsub:message" 事件推送。
func (s *RedisService) Subscribe(connectionID string, db int, target string, pattern bool) (SubscriptionInfo, error) {
	entry, err := s.entry(connectionID)
	if err != nil {
		return SubscriptionInfo{}, err
	}

	target = strings.TrimSpace(target)
	if target == "" {
		return SubscriptionInfo{}, newAppError("pubsubTargetRequired")
	}

	client := entry.client(db)
	var pubsub *redis.PubSub
	kind := "channel"
	if pattern {
		kind = "pattern"
		pubsub = client.PSubscribe(context.Background(), target)
	} else {
		pubsub = client.Subscribe(context.Background(), target)
	}

	if _, err := pubsub.ReceiveTimeout(context.Background(), 3*time.Second); err != nil {
		_ = pubsub.Close()
		return SubscriptionInfo{}, newAppError("subscribeFailed", "detail", err.Error())
	}

	info := SubscriptionInfo{
		ID:     randomID(),
		Kind:   kind,
		Target: target,
	}
	sub := &subscription{
		info:         info,
		connectionID: connectionID,
		pubsub:       pubsub,
	}

	s.subsMu.Lock()
	s.subs[info.ID] = sub
	s.subsMu.Unlock()

	go s.readSubscription(sub, pubsub.Channel())
	return info, nil
}

func (s *RedisService) readSubscription(sub *subscription, messages <-chan *redis.Message) {
	for message := range messages {
		sub.messages.Add(1)
		emitter := s.eventEmitter
		if emitter == nil {
			continue
		}
		emitter("pubsub:message", PubSubMessage{
			ConnectionID:   sub.connectionID,
			SubscriptionID: sub.info.ID,
			Channel:        message.Channel,
			Pattern:        message.Pattern,
			Payload:        message.Payload,
			Timestamp:      time.Now().UnixMilli(),
		})
	}
}

// Unsubscribe 取消订阅并关闭对应的 PubSub 连接。
func (s *RedisService) Unsubscribe(connectionID string, subscriptionID string) error {
	s.subsMu.Lock()
	sub, ok := s.subs[subscriptionID]
	if ok && sub.connectionID == connectionID {
		delete(s.subs, subscriptionID)
	} else {
		sub = nil
	}
	s.subsMu.Unlock()

	if sub == nil {
		return nil
	}
	return sub.pubsub.Close()
}

func (s *RedisService) ListSubscriptions(connectionID string) []SubscriptionInfo {
	s.subsMu.Lock()
	defer s.subsMu.Unlock()

	result := make([]SubscriptionInfo, 0)
	for _, sub := range s.subs {
		if sub.connectionID != connectionID {
			continue
		}
		info := sub.info
		info.Messages = sub.messages.Load()
		result = append(result, info)
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].Target < result[j].Target
	})
	return result
}

// Publish 向频道发布消息，返回接收消息的订阅者数量。
func (s *RedisService) Publish(connectionID string, db int, channel string, message string) (int64, error) {
	entry, err := s.entry(connectionID)
	if err != nil {
		return 0, err
	}

	channel = strings.TrimSpace(channel)
	if channel == "" {
		return 0, newAppError("pubsubChannelRequired")
	}
	if strings.TrimSpace(message) == "" {
		return 0, newAppError("pubsubMessageRequired")
	}

	ctx, cancel := context.WithTimeout(context.Background(), opTimeout)
	defer cancel()

	return entry.client(db).Publish(ctx, channel, message).Result()
}

func (s *RedisService) closeSubscriptions(connectionID string) {
	s.subsMu.Lock()
	closing := make([]*subscription, 0)
	for id, sub := range s.subs {
		if sub.connectionID == connectionID {
			closing = append(closing, sub)
			delete(s.subs, id)
		}
	}
	s.subsMu.Unlock()

	for _, sub := range closing {
		_ = sub.pubsub.Close()
	}
}
