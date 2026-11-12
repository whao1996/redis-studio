package main

import (
	"encoding/json"
	"errors"
)

// 错误以固定前缀 + JSON 载荷返回，前端根据 code 做本地化。
const appErrorPrefix = "APPERR:"

type appErrorPayload struct {
	Code   string            `json:"code"`
	Params map[string]string `json:"params,omitempty"`
}

func newAppError(code string, kv ...string) error {
	params := make(map[string]string, len(kv)/2)
	for i := 0; i+1 < len(kv); i += 2 {
		params[kv[i]] = kv[i+1]
	}

	payload, err := json.Marshal(appErrorPayload{Code: code, Params: params})
	if err != nil {
		return errors.New(code)
	}
	return errors.New(appErrorPrefix + string(payload))
}
