// Example: a minimal PluginBridge plugin using the Go SDK.
//
// Build: go build -o ./example-adapter ./example
// Test:  run the repository's direct Plugin conformance tests.
//
// This echo adapter reports itself as available + native-visible, and echoes
// any inbound message back as a completed PluginEvent. Use it as a starting
// point for a real adapter.
package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"

	pluginbridge "github.com/Rokid-Prism/prism-plugin-sdk"
)

type echoAdapter struct{}

func (a *echoAdapter) ID() string { return "echo" }

func (a *echoAdapter) Probe(context.Context) (pluginbridge.Capability, error) {
	return pluginbridge.Capability{
		PluginID:                   "echo",
		Available:                  true,
		NativeVisibleInput:         true,
		CanStartSessionWithMessage: true,
		IntegrationMode:            pluginbridge.IntegrationModeProtocolNative,
		VisibilitySurface:          "echo",
	}, nil
}

func (a *echoAdapter) Discover(context.Context) (pluginbridge.DiscoveryResult, error) {
	return pluginbridge.DiscoveryResult{PluginID: "echo", Surface: "echo", Verified: true}, nil
}

func (a *echoAdapter) StartSessionWithMessage(_ context.Context, req pluginbridge.StartSessionWithMessageRequest) (pluginbridge.StartSessionWithMessageResult, error) {
	if req.Message.PrismMessageID == "" || req.Message.Text == "" {
		return pluginbridge.StartSessionWithMessageResult{}, fmt.Errorf("first message id and text required")
	}
	session := pluginbridge.NativeSession{
		PluginID:        "echo",
		NativeSessionID: "echo:" + req.Message.PrismMessageID,
		NativeThreadID:  "echo:" + req.Message.PrismMessageID,
		Surface:         "echo",
		Cwd:             req.Cwd,
		Visible:         true,
	}
	return pluginbridge.StartSessionWithMessageResult{
		Session:    session,
		Receipt:    pluginbridge.SendReceipt{NativeMessageID: req.Message.PrismMessageID, Accepted: true, Visible: true},
		Visibility: pluginbridge.VisibilityResult{Visible: true, Marker: req.Message.Text, Evidence: "echo adapter", CheckedAt: time.Now().UTC()},
	}, nil
}

func (a *echoAdapter) Send(_ context.Context, _ pluginbridge.NativeSession, msg pluginbridge.InboundMessage) (pluginbridge.SendReceipt, error) {
	return pluginbridge.SendReceipt{
		NativeMessageID: uuid.NewString(),
		Accepted:        true,
		Visible:         true,
		Detail:          fmt.Sprintf("echoed %d chars", len(msg.Text)),
	}, nil
}

func (a *echoAdapter) Subscribe(ctx context.Context, _ pluginbridge.NativeSession) (<-chan pluginbridge.PluginEvent, error) {
	// A real adapter would forward the native application's event stream here.
	ch := make(chan pluginbridge.PluginEvent, 1)
	go func() {
		select {
		case <-ctx.Done():
		case ch <- pluginbridge.PluginEvent{
			ID:        uuid.NewString(),
			Type:      "completed",
			Status:    "completed",
			Summary:   "echo done",
			CreatedAt: time.Now().UTC(),
		}:
		}
		close(ch)
	}()
	return ch, nil
}

func (a *echoAdapter) Interrupt(context.Context, pluginbridge.NativeSession, string) error {
	return nil
}

func (a *echoAdapter) VerifyVisibility(_ context.Context, _ pluginbridge.NativeSession, marker string) (pluginbridge.VisibilityResult, error) {
	return pluginbridge.VisibilityResult{
		Visible:   true,
		Marker:    marker,
		Evidence:  "echo adapter always visible",
		CheckedAt: time.Now().UTC(),
	}, nil
}

func (a *echoAdapter) Close(context.Context) error { return nil }

func main() {
	if err := pluginbridge.Serve(context.Background(), &echoAdapter{}); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
