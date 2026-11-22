package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
)

func newTestApp(t *testing.T, runID string) *App {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "levelboard.db")
	store, err := openStore(dbPath)
	if err != nil {
		t.Fatalf("openStore: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return &App{store: store, runID: runID, version: "0.1.0", commit: nil}
}

func do(t *testing.T, app *App, method, path, body, contentType string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Reader
	if body == "" {
		reader = bytes.NewReader(nil)
	} else {
		reader = bytes.NewReader([]byte(body))
	}
	req := httptest.NewRequest(method, path, reader)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	w := httptest.NewRecorder()
	app.routes().ServeHTTP(w, req)
	return w
}

func postJSON(app *App, t *testing.T, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	return do(t, app, http.MethodPost, path, body, "application/json")
}

func TestHealth(t *testing.T) {
	app := newTestApp(t, "lokal")
	w := do(t, app, http.MethodGet, "/api/health", "", "")
	if w.Code != 200 {
		t.Fatalf("status = %d", w.Code)
	}
	if got := w.Header().Get("Content-Type"); got != "application/json" {
		t.Fatalf("content-type = %q", got)
	}
	var body struct {
		Status  string  `json:"status"`
		Version string  `json:"version"`
		Commit  *string `json:"commit"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Status != "ok" || body.Version != "0.1.0" || body.Commit != nil {
		t.Fatalf("unexpected body: %+v", body)
	}
}

func TestGetLevelsInitial(t *testing.T) {
	app := newTestApp(t, "lokal")
	w := do(t, app, http.MethodGet, "/api/levels", "", "")
	if w.Code != 200 {
		t.Fatalf("status = %d", w.Code)
	}
	var body ResultsJSON
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if len(body.Levels) != 10 {
		t.Fatalf("levels = %d", len(body.Levels))
	}
	if body.Run.ID != "lokal" || body.Run.UpdatedAt != nil {
		t.Fatalf("run = %+v", body.Run)
	}
	for i, l := range body.Levels {
		if l.Level != i+1 || l.Status != "offen" || l.CheckedAt != nil || l.DurationMs != nil {
			t.Fatalf("level %d = %+v", i+1, l)
		}
	}
}

func TestPostResultSuccess(t *testing.T) {
	app := newTestApp(t, "lokal")
	w := postJSON(app, t, "/api/levels/1/result", `{"checks":[{"name":"a","ok":true}],"durationMs":10}`)
	if w.Code != 200 {
		t.Fatalf("status = %d, body = %s", w.Code, w.Body.String())
	}
	var body ResultsJSON
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Levels[0].Status != "bestanden" || *body.Levels[0].DurationMs != 10 {
		t.Fatalf("level 1 = %+v", body.Levels[0])
	}
	if body.Run.UpdatedAt == nil {
		t.Fatalf("updatedAt fehlt")
	}
}

func TestPostResultFailureLocksHigher(t *testing.T) {
	app := newTestApp(t, "lokal")
	w := postJSON(app, t, "/api/levels/1/result", `{"checks":[{"name":"a","ok":false}],"durationMs":5}`)
	if w.Code != 200 {
		t.Fatalf("status = %d", w.Code)
	}
	var body ResultsJSON
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Levels[0].Status != "fehlgeschlagen" {
		t.Fatalf("level 1 = %+v", body.Levels[0])
	}
	for i := 1; i < 10; i++ {
		if body.Levels[i].Status != "gesperrt" {
			t.Fatalf("level %d = %+v", i+1, body.Levels[i])
		}
	}
}

func TestPostResultWrongOrder(t *testing.T) {
	app := newTestApp(t, "lokal")
	w := postJSON(app, t, "/api/levels/2/result", `{"checks":[{"name":"a","ok":true}],"durationMs":10}`)
	if w.Code != 409 {
		t.Fatalf("status = %d", w.Code)
	}
	var body map[string]string
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["error"] != "ein niedrigeres Level ist nicht bestanden" {
		t.Fatalf("error = %q", body["error"])
	}
}

func TestPostResultBadRequests(t *testing.T) {
	app := newTestApp(t, "lokal")
	cases := []string{
		"{kaputt",
		"{}",
		`{"checks":[]}`,
		`{"checks":[{"name":"a","ok":true}]}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":1.5}`,
		`{"checks":[{"name":"a","ok":true}],"durationMs":10,"extra":1}`,
		`{"checks":[{"name":"","ok":true}],"durationMs":10}`,
		`{"checks":[{"name":"a","ok":true,"x":1}],"durationMs":10}`,
	}
	for _, c := range cases {
		w := postJSON(app, t, "/api/levels/1/result", c)
		if w.Code != 400 {
			t.Fatalf("body %q: status = %d, body = %s", c, w.Code, w.Body.String())
		}
	}
}

func TestUnknownLevel(t *testing.T) {
	app := newTestApp(t, "lokal")
	for _, p := range []string{"/api/levels/0", "/api/levels/11", "/api/levels/abc"} {
		w := do(t, app, http.MethodGet, p, "", "")
		if w.Code != 404 {
			t.Fatalf("%s: status = %d", p, w.Code)
		}
	}
}

func TestWrongMethods(t *testing.T) {
	app := newTestApp(t, "lokal")
	if w := do(t, app, http.MethodDelete, "/api/levels", "", ""); w.Code != 405 || w.Header().Get("Allow") != "GET" {
		t.Fatalf("DELETE /api/levels: %d, allow=%q", w.Code, w.Header().Get("Allow"))
	}
	if w := do(t, app, http.MethodGet, "/api/levels/1/result", "", ""); w.Code != 405 || w.Header().Get("Allow") != "POST" {
		t.Fatalf("GET result: %d, allow=%q", w.Code, w.Header().Get("Allow"))
	}
	if w := do(t, app, http.MethodPost, "/api/usage", "", "application/json"); w.Code != 405 {
		t.Fatalf("POST usage: %d", w.Code)
	} else if !contains(w.Header().Get("Allow"), "PUT") {
		t.Fatalf("allow = %q", w.Header().Get("Allow"))
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || indexOf(s, sub) >= 0)
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}

func TestContentTypeAndSize(t *testing.T) {
	app := newTestApp(t, "lokal")
	w := do(t, app, http.MethodPost, "/api/levels/1/result", `{"checks":[{"name":"a","ok":true}],"durationMs":10}`, "text/plain")
	if w.Code != 415 {
		t.Fatalf("415 erwartet, %d", w.Code)
	}

	big := make([]byte, 65537)
	for i := range big {
		big[i] = 'a'
	}
	w = do(t, app, http.MethodPost, "/api/levels/1/result", string(big), "application/json")
	if w.Code != 413 {
		t.Fatalf("413 erwartet, %d", w.Code)
	}
}

func TestHistoryOrderAndLimit(t *testing.T) {
	app := newTestApp(t, "lokal")
	postJSON(app, t, "/api/levels/1/result", `{"checks":[{"name":"a","ok":true}],"durationMs":101}`)
	postJSON(app, t, "/api/levels/1/result", `{"checks":[{"name":"a","ok":true}],"durationMs":102}`)

	w := do(t, app, http.MethodGet, "/api/levels/1/history", "", "")
	if w.Code != 200 {
		t.Fatalf("status = %d", w.Code)
	}
	var hist HistoryJSON
	if err := json.Unmarshal(w.Body.Bytes(), &hist); err != nil {
		t.Fatal(err)
	}
	if len(hist.Entries) < 2 {
		t.Fatalf("entries = %d", len(hist.Entries))
	}
	if hist.Entries[0].DurationMs != 102 || hist.Entries[1].DurationMs != 101 {
		t.Fatalf("order wrong: %+v", hist.Entries)
	}
	if hist.Entries[0].ID <= hist.Entries[1].ID {
		t.Fatalf("ids wrong")
	}

	w = do(t, app, http.MethodGet, "/api/levels/1/history?limit=1", "", "")
	var one HistoryJSON
	if err := json.Unmarshal(w.Body.Bytes(), &one); err != nil {
		t.Fatal(err)
	}
	if len(one.Entries) != 1 {
		t.Fatalf("limit entries = %d", len(one.Entries))
	}

	for _, l := range []string{"0", "501"} {
		w = do(t, app, http.MethodGet, "/api/levels/1/history?limit="+l, "", "")
		if w.Code != 400 {
			t.Fatalf("limit %s: %d", l, w.Code)
		}
	}
}

func TestPersistence(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "levelboard.db")

	store, err := openStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	app := &App{store: store, runID: "lokal", version: "0.1.0", commit: nil}
	postJSON(app, t, "/api/levels/1/result", `{"checks":[{"name":"a","ok":true}],"durationMs":10}`)
	store.Close()

	store2, err := openStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer store2.Close()
	app2 := &App{store: store2, runID: "lokal", version: "0.1.0", commit: nil}
	w := do(t, app2, http.MethodGet, "/api/levels", "", "")
	var body ResultsJSON
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Levels[0].Status != "bestanden" {
		t.Fatalf("persistence lost: %+v", body.Levels[0])
	}
}

func TestUsagePutGet(t *testing.T) {
	app := newTestApp(t, "lokal")
	w := do(t, app, http.MethodGet, "/api/usage", "", "")
	if w.Code != 200 || w.Body.String() != "{}" {
		t.Fatalf("initial usage: %d %s", w.Code, w.Body.String())
	}

	w = do(t, app, http.MethodPut, "/api/usage", `{"total":{"output":1,"total":2,"costUsd":3.5}}`, "application/json")
	if w.Code != 200 {
		t.Fatalf("put: %d %s", w.Code, w.Body.String())
	}

	w = do(t, app, http.MethodGet, "/api/usage", "", "")
	if w.Code != 200 || w.Body.String() != `{"total":{"output":1,"total":2,"costUsd":3.5}}` {
		t.Fatalf("get after put: %d %s", w.Code, w.Body.String())
	}

	if w := do(t, app, http.MethodPut, "/api/usage", `[1,2]`, "application/json"); w.Code != 400 {
		t.Fatalf("array: %d", w.Code)
	}
	if w := do(t, app, http.MethodPut, "/api/usage", `{kaputt`, "application/json"); w.Code != 400 {
		t.Fatalf("broken: %d", w.Code)
	}
	if w := do(t, app, http.MethodPut, "/api/usage", `{}`, "text/plain"); w.Code != 415 {
		t.Fatalf("ct: %d", w.Code)
	}

	w = do(t, app, http.MethodPut, "/api/usage", `{}`, "application/json")
	if w.Code != 200 || w.Body.String() != "{}" {
		t.Fatalf("clear: %d %s", w.Code, w.Body.String())
	}
}
