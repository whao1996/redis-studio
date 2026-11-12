package main

import (
	"os/exec"
	"runtime"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// handleTitleBarDoubleClick 按 macOS 系统偏好执行标题栏双击动作。
func handleTitleBarDoubleClick(window *application.WebviewWindow) {
	if window == nil {
		return
	}

	action := "maximize"
	if runtime.GOOS == "darwin" {
		action = readAppleDoubleClickAction()
	}

	applyTitleBarAction(action, window.ToggleMaximise, func() {
		window.Minimise()
	})
}

func applyTitleBarAction(action string, maximise func(), minimise func()) {
	switch action {
	case "minimize":
		minimise()
	case "none":
		return
	default:
		maximise()
	}
}

func readAppleDoubleClickAction() string {
	output, err := exec.Command("defaults", "read", "-g", "AppleActionOnDoubleClick").Output()
	if err != nil {
		return "maximize"
	}
	return parseAppleDoubleClickAction(string(output))
}

func parseAppleDoubleClickAction(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "minimize":
		return "minimize"
	case "none", "donothing", "do nothing":
		return "none"
	default:
		// Fill / Maximize / Zoom 都按窗口缩放处理。
		return "maximize"
	}
}
