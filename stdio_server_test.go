package pluginbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

// TestServeRoundTrip exercises the full stdio protocol loop: send a request
// on stdin, read the response on stdout, verify the JSON field names match the
// locked contract.
func TestServeRoundTrip(t *testing.T) {
	in := strings.NewReader(`{"id":"req-1","method":"adapter.probe","params":{}}` + "\n")
	var out bytes.Buffer
	server := &StdioServer{
		Adapter: &stubAdapter{},
		In:      in,
		Out:     &out,
	}
	if err := server.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}

	var resp rpcResponse
	if err := json.Unmarshal(bytes.TrimSpace(out.Bytes()), &resp); err != nil {
		t.Fatalf("unmarshal response: %v (raw=%q)", err, out.String())
	}
	if resp.ID != "req-1" || !resp.OK {
		t.Fatalf("unexpected response: %+v", resp)
	}

	// SDK structs use Go names, while the v4 wire payload is snake_case.
	var cap Capability
	if err := unmarshalWire(resp.Payload, &cap); err != nil {
		t.Fatalf("unmarshal capability: %v", err)
	}
	if cap.PluginID != "stub" || !cap.Available || !cap.NativeVisibleInput {
		t.Fatalf("unexpected capability: %+v", cap)
	}
}

// TestWireFieldNamesAreSnakeCase guards the v4 stdio field contract.
func TestWireFieldNamesAreSnakeCase(t *testing.T) {
	cases := []struct {
		name    string
		value   any
		wantKey string
	}{
		{"Capability.PluginID", Capability{PluginID: "x"}, "plugin_id"},
		{"Capability.NativeVisibleInput", Capability{NativeVisibleInput: true}, "native_visible_input"},
		{"Capability.CanListSessions", Capability{CanListSessions: true}, "can_list_sessions"},
		{"Capability.CanReadHistory", Capability{CanReadHistory: true}, "can_read_history"},
		{"Capability.CanReverseSync", Capability{CanReverseSync: true}, "can_reverse_sync"},
		{"Capability.IntegrationMode", Capability{IntegrationMode: IntegrationModeProtocolNative}, "integration_mode"},
		{"Capability.VisibilitySurface", Capability{VisibilitySurface: "gw"}, "visibility_surface"},
		{"Capability.UnavailableReason", Capability{UnavailableReason: "off"}, "unavailable_reason"},
		{"StartSessionWithMessageRequest.PluginID", StartSessionWithMessageRequest{PluginID: "stub"}, "plugin_id"},
		{"AttachSessionRequest.NativeSessionID", AttachSessionRequest{NativeSessionID: "s"}, "native_session_id"},
		{"NativeSession.NativeSessionID", NativeSession{NativeSessionID: "s"}, "native_session_id"},
		{"NativeSessionHint.LastActivityAt", NativeSessionHint{LastActivityAt: time.Now()}, "last_activity_at"},
		{"InboundMessage.PrismMessageID", InboundMessage{PrismMessageID: "m"}, "prism_message_id"},
		{"SendReceipt.NativeMessageID", SendReceipt{NativeMessageID: "r"}, "native_message_id"},
		{"SendReceipt.CanonicalNativeSessionID", SendReceipt{CanonicalNativeSessionID: "s"}, "canonical_native_session_id"},
		{"SendReceipt.CanonicalNativeThreadID", SendReceipt{CanonicalNativeThreadID: "t"}, "canonical_native_thread_id"},
		{"SendReceipt.QueuePending", SendReceipt{QueuePending: true}, "queue_pending"},
		{"VisibilityResult.CheckedAt", VisibilityResult{CheckedAt: time.Now()}, "checked_at"},
		{"PluginEvent.Summary", PluginEvent{Summary: "x"}, "summary"},
		{"DiscoveryResult.SessionHints", DiscoveryResult{SessionHints: map[string]string{}}, "session_hints"},
		{"HistoryTurn.OrderKey", HistoryTurn{OrderKey: "100"}, "order_key"},
		{"HistoryMessage.Progress", HistoryMessage{Progress: &HistoryProgress{StartedAt: time.Now(), Steps: []HistoryProgressStep{{ID: "step"}}}}, "progress"},
		{"HistoryProgressStep.CallID", HistoryProgressStep{CallID: "call-1"}, "call_id"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			b, err := marshalWire(tc.value)
			if err != nil {
				t.Fatalf("marshal: %v", err)
			}
			var m map[string]any
			if err := json.Unmarshal(b, &m); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			if _, ok := m[tc.wantKey]; !ok {
				t.Fatalf("expected JSON key %q in %s, got keys: %v", tc.wantKey, b, m)
			}
		})
	}
}

func TestOptionalSessionMethodsRoundTrip(t *testing.T) {
	input := strings.Join([]string{
		`{"id":"req-list","method":"adapter.listSessions","params":{}}`,
		`{"id":"req-attach","method":"adapter.attachSession","params":{"native_session_id":"s"}}`,
	}, "\n") + "\n"
	in := strings.NewReader(input)
	var out bytes.Buffer
	server := &StdioServer{
		Adapter: &stubAdapter{},
		In:      in,
		Out:     &out,
	}
	if err := server.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	lines := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(lines) != 2 {
		t.Fatalf("expected 2 responses, got %d: %q", len(lines), out.String())
	}
	var listResp rpcResponse
	if err := json.Unmarshal([]byte(lines[0]), &listResp); err != nil {
		t.Fatalf("unmarshal list response: %v", err)
	}
	if !listResp.OK {
		t.Fatalf("unexpected list response: %+v", listResp)
	}
	var hints []NativeSessionHint
	if err := unmarshalWire(listResp.Payload, &hints); err != nil {
		t.Fatalf("unmarshal hints: %v", err)
	}
	if len(hints) != 1 || hints[0].NativeSessionID != "s" {
		t.Fatalf("unexpected hints: %+v", hints)
	}
	var attachResp rpcResponse
	if err := json.Unmarshal([]byte(lines[1]), &attachResp); err != nil {
		t.Fatalf("unmarshal attach response: %v", err)
	}
	if !attachResp.OK {
		t.Fatalf("unexpected attach response: %+v", attachResp)
	}
	var session NativeSession
	if err := unmarshalWire(attachResp.Payload, &session); err != nil {
		t.Fatalf("unmarshal session: %v", err)
	}
	if session.NativeSessionID != "s" || !session.Visible {
		t.Fatalf("unexpected attached session: %+v", session)
	}
}

type stubAdapter struct{}

func (a *stubAdapter) ID() string { return "stub" }

func (a *stubAdapter) Probe(context.Context) (Capability, error) {
	return Capability{PluginID: "stub", Available: true, NativeVisibleInput: true, IntegrationMode: IntegrationModeProtocolNative, VisibilitySurface: "test"}, nil
}
func (a *stubAdapter) Discover(context.Context) (DiscoveryResult, error) {
	return DiscoveryResult{PluginID: "stub", Verified: true}, nil
}
func (a *stubAdapter) ListSessions(context.Context) ([]NativeSessionHint, error) {
	return []NativeSessionHint{{PluginID: "stub", NativeSessionID: "s", Title: "Stub Session", Active: true, Visible: true}}, nil
}
func (a *stubAdapter) AttachSession(context.Context, AttachSessionRequest) (NativeSession, error) {
	return NativeSession{PluginID: "stub", NativeSessionID: "s", Visible: true}, nil
}
func (a *stubAdapter) Send(context.Context, NativeSession, InboundMessage) (SendReceipt, error) {
	return SendReceipt{}, nil
}
func (a *stubAdapter) Subscribe(context.Context, NativeSession) (<-chan PluginEvent, error) {
	return nil, nil
}
func (a *stubAdapter) Interrupt(context.Context, NativeSession, string) error { return nil }
func (a *stubAdapter) VerifyVisibility(context.Context, NativeSession, string) (VisibilityResult, error) {
	return VisibilityResult{}, nil
}
func (a *stubAdapter) Close(context.Context) error { return nil }

type historyStubAdapter struct {
	stubAdapter
	session NativeSession
	request HistoryStreamRequest
}

func (a *historyStubAdapter) ReadDetail(_ context.Context, session NativeSession) (map[string]any, error) {
	a.session = session
	return map[string]any{
		"conversation_id": session.NativeSessionID,
		"model":           map[string]any{"key": "gpt-test", "label": "GPT Test"},
	}, nil
}

func (a *historyStubAdapter) ReadHistoryStream(_ context.Context, session NativeSession, request HistoryStreamRequest) (<-chan HistoryStreamEvent, error) {
	a.session = session
	a.request = request
	events := make(chan HistoryStreamEvent, 1)
	events <- HistoryStreamEvent{StreamID: request.StreamID, Type: "end", Source: "initial", Operation: "append"}
	close(events)
	return events, nil
}

func TestHistoryStreamPreservesNestedSnakeCaseRequest(t *testing.T) {
	adapter := &historyStubAdapter{}
	server := &StdioServer{Adapter: adapter, subs: map[string]context.CancelFunc{}, history: map[string]context.CancelFunc{}}
	var out bytes.Buffer
	result, err := server.handle(context.Background(), "adapter.readHistoryStream", map[string]any{
		"session": map[string]any{"plugin_id": "stub", "native_session_id": "session-1", "visible": true},
		"request": map[string]any{"stream_id": "body-1", "limit": 5, "live": true},
	}, &lockedEncoder{enc: json.NewEncoder(&out)})
	if err != nil {
		t.Fatalf("readHistoryStream: %v", err)
	}
	ack, _ := result.(map[string]any)
	if ack["stream_id"] != "body-1" {
		t.Fatalf("unexpected history stream ack: %+v", result)
	}
	if adapter.session.NativeSessionID != "session-1" || adapter.request.StreamID != "body-1" || adapter.request.Limit != 5 || !adapter.request.Live {
		t.Fatalf("history stream request was not preserved: session=%+v request=%+v", adapter.session, adapter.request)
	}
	deadline := time.Now().Add(time.Second)
	for !strings.Contains(out.String(), `"stream_id":"body-1"`) && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if !strings.Contains(out.String(), `"event":"history.stream"`) || !strings.Contains(out.String(), `"stream_id":"body-1"`) {
		t.Fatalf("missing history stream event: %s", out.String())
	}
}

func TestReadDetailPreservesSessionAndDynamicSnapshotKeys(t *testing.T) {
	adapter := &historyStubAdapter{}
	server := &StdioServer{Adapter: adapter, subs: map[string]context.CancelFunc{}, history: map[string]context.CancelFunc{}}
	result, err := server.handle(context.Background(), "adapter.readDetail", map[string]any{
		"session": map[string]any{"plugin_id": "stub", "native_session_id": "session-1", "visible": true},
	}, &lockedEncoder{enc: json.NewEncoder(&bytes.Buffer{})})
	if err != nil {
		t.Fatalf("readDetail: %v", err)
	}
	detail, _ := result.(map[string]any)
	if adapter.session.NativeSessionID != "session-1" || detail["conversation_id"] != "session-1" {
		t.Fatalf("unexpected detail result: session=%+v detail=%+v", adapter.session, detail)
	}
	model, _ := detail["model"].(map[string]any)
	if model["key"] != "gpt-test" {
		t.Fatalf("dynamic detail keys changed: %+v", detail)
	}
}

func TestCheckProtocolVersion(t *testing.T) {
	// Absent env var: passes (standalone/debug runs).
	t.Setenv("PRISM_PLUGIN_PROTOCOL_VERSION", "")
	if err := CheckProtocolVersion(); err != nil {
		t.Fatalf("expected no error when env absent, got %v", err)
	}
	// Matching version: passes.
	t.Setenv("PRISM_PLUGIN_PROTOCOL_VERSION", ProtocolVersion)
	if err := CheckProtocolVersion(); err != nil {
		t.Fatalf("expected no error for matching version, got %v", err)
	}
	// Mismatch: fails with an informative message.
	t.Setenv("PRISM_PLUGIN_PROTOCOL_VERSION", "999")
	err := CheckProtocolVersion()
	if err == nil {
		t.Fatal("expected error for version mismatch, got nil")
	}
	if !strings.Contains(err.Error(), "mismatch") {
		t.Fatalf("expected mismatch message, got %v", err)
	}
}

func TestRunFailsFastOnProtocolMismatch(t *testing.T) {
	t.Setenv("PRISM_PLUGIN_PROTOCOL_VERSION", "999")
	srv := &StdioServer{Adapter: &stubAdapter{}, In: &bytes.Buffer{}, Out: &bytes.Buffer{}}
	err := srv.Run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "mismatch") {
		t.Fatalf("expected protocol mismatch error from Run, got %v", err)
	}
}

func TestResolveApprovalRoundTrip(t *testing.T) {
	input := bytes.NewBufferString(`{"id":"req-resolve","method":"adapter.resolveApproval","params":{"prism_conversation_id":"conv-1","plugin_id":"stub","session":{"plugin_id":"stub","native_session_id":"s","visible":true},"approval_request_id":"approval-1","action_id":"approve_with_note","input":"current directory only","source_device":"glasses","metadata":{"k":"v"}}}` + "\n")
	var out bytes.Buffer
	srv := &StdioServer{Adapter: &approvalStubAdapter{}, In: input, Out: &out}
	if err := srv.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	var resp rpcResponse
	line := strings.TrimSpace(out.String())
	if err := json.Unmarshal([]byte(line), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if !resp.OK || resp.ID != "req-resolve" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestPascalCaseRequestIsRejected(t *testing.T) {
	in := strings.NewReader(`{"id":"req-attach","method":"adapter.attachSession","params":{"NativeSessionID":"s"}}` + "\n")
	var out bytes.Buffer
	server := &StdioServer{Adapter: &stubAdapter{}, In: in, Out: &out}
	if err := server.Run(context.Background()); err != nil {
		t.Fatalf("Run: %v", err)
	}
	var resp rpcResponse
	if err := json.Unmarshal(bytes.TrimSpace(out.Bytes()), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	if resp.OK || resp.Error == nil || !strings.Contains(resp.Error.Message, "snake_case") {
		t.Fatalf("expected strict snake_case rejection, got %+v", resp)
	}
}

func TestSharedProtocolFixturePreservesOpaqueControlAndPluginWideWatch(t *testing.T) {
	fixture := loadProtocolFixture(t)
	control := fixture["control_session"].(map[string]any)
	wide := fixture["plugin_wide"].(map[string]any)

	adapter := &fixtureAdapter{events: make(chan PluginEvent, 1)}
	server := &StdioServer{Adapter: adapter, subs: map[string]context.CancelFunc{}, history: map[string]context.CancelFunc{}}
	var out bytes.Buffer
	enc := &lockedEncoder{enc: json.NewEncoder(&out)}
	if _, err := server.handle(context.Background(), control["method"].(string), control["params"], enc); err != nil {
		t.Fatalf("control fixture: %v", err)
	}
	if got, want := adapter.control.Target, control["params"].(map[string]any)["target"]; !reflect.DeepEqual(got, want) {
		t.Fatalf("opaque target changed: got %#v want %#v", got, want)
	}
	if got, want := adapter.control.Metadata, map[string]any{"request_id": "request-1", "source_device": "mobile", "runtime": map[string]any{"menu_session_id": "menu-1"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("metadata changed: got %#v want %#v", got, want)
	}

	event := wide["event"].(map[string]any)
	adapter.events <- PluginEvent{
		ID: event["id"].(string), Type: event["type"].(string), Status: event["status"].(string),
		Summary: event["summary"].(string), Payload: event["payload"].(map[string]any), CreatedAt: time.Now().UTC(),
	}
	close(adapter.events)
	if _, err := server.handle(context.Background(), wide["method"].(string), wide["params"], enc); err != nil {
		t.Fatalf("plugin-wide fixture: %v", err)
	}
	deadline := time.Now().Add(time.Second)
	for !strings.Contains(out.String(), `"event":"plugin.event"`) && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if !strings.Contains(out.String(), `"subscription_id":"wide-1"`) || !strings.Contains(out.String(), `"type":"desktop.session.changed"`) {
		t.Fatalf("missing plugin-wide event: %s", out.String())
	}

	cancel := fixture["history_cancel"].(map[string]any)
	cancelled := false
	server.history["body-1"] = func() { cancelled = true }
	if _, err := server.handle(context.Background(), cancel["method"].(string), cancel["params"], enc); err != nil {
		t.Fatalf("history cancel fixture: %v", err)
	}
	if !cancelled {
		t.Fatal("history cancel did not invoke the registered stream cancellation")
	}
}

func loadProtocolFixture(t *testing.T) map[string]any {
	t.Helper()
	path := filepath.Join("conformance", "v4-plugin-wide.json")
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read fixture %s: %v", path, err)
	}
	var fixture map[string]any
	if err := json.Unmarshal(data, &fixture); err != nil {
		t.Fatalf("decode fixture: %v", err)
	}
	return fixture
}

type approvalStubAdapter struct{ stubAdapter }

func (a *approvalStubAdapter) ResolveApproval(context.Context, ApprovalResolutionRequest) error {
	return nil
}

type fixtureAdapter struct {
	stubAdapter
	control ControlSessionRequest
	events  chan PluginEvent
}

func (a *fixtureAdapter) ControlSession(_ context.Context, req ControlSessionRequest) (ControlSessionResult, error) {
	a.control = req
	return ControlSessionResult{OK: true}, nil
}

func (a *fixtureAdapter) SubscribePlugin(context.Context) (<-chan PluginEvent, error) {
	return a.events, nil
}
