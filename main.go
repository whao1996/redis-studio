package main

import (
	"embed"
	"log"
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

// Wails 使用 embed 将前端构建产物打包进二进制。
//
//go:embed all:frontend/dist
var assets embed.FS

func main() {
	redisService := NewRedisService()

	app := application.New(application.Options{
		Name:        "Redis Studio",
		Description: "A lightweight Redis GUI client",
		Services: []application.Service{
			application.NewService(redisService),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})

	redisService.SetEventEmitter(func(name string, payload any) {
		app.Event.Emit(name, payload)
	})

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:     "Redis Studio",
		Width:     1280,
		Height:    820,
		MinWidth:  980,
		MinHeight: 620,
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 50,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
		BackgroundColour: application.NewRGB(15, 17, 23),
		URL:              "/",
	})

	// 首次显示后再最大化：窗口尚未上屏时直接 zoom 会得到异常尺寸。
	var maximiseOnce sync.Once
	window.OnWindowEvent(events.Common.WindowShow, func(*application.WindowEvent) {
		maximiseOnce.Do(func() { window.Maximise() })
	})

	redisService.SetTitleBarHandler(func() {
		handleTitleBarDoubleClick(window)
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
