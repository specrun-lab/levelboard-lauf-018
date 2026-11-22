package main

import (
	"bytes"
	"encoding/json"
	"io"
	"mime"
	"net/http"
	"strconv"
)

type App struct {
	store   *Store
	runID   string
	version string
	commit  *string
}

func (a *App) routes() *http.ServeMux {
	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", a.handleHealth)
	mux.HandleFunc("/api/levels", a.handleLevels)
	mux.HandleFunc("/api/levels/{n}", a.handleLevel)
	mux.HandleFunc("/api/levels/{n}/result", a.handleResult)
	mux.HandleFunc("/api/levels/{n}/history", a.handleHistory)
	mux.HandleFunc("/api/usage", a.handleUsage)
	mux.HandleFunc("/", a.handleNotFound)
	return mux
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	_, _ = w.Write(b)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func methodNotAllowed(w http.ResponseWriter, allow string) {
	w.Header().Set("Allow", allow)
	writeError(w, http.StatusMethodNotAllowed, "Methode nicht erlaubt")
}

func parseLevel(n string) (int, bool) {
	if n == "" {
		return 0, false
	}
	v, err := strconv.Atoi(n)
	if err != nil || v < 1 || v > 10 {
		return 0, false
	}
	return v, true
}

func isJSONContentType(ct string) bool {
	mt, _, err := mime.ParseMediaType(ct)
	if err != nil {
		return false
	}
	return mt == "application/json"
}

func (a *App) handleNotFound(w http.ResponseWriter, r *http.Request) {
	writeError(w, http.StatusNotFound, "nicht gefunden")
}

func (a *App) handleHealth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	writeJSON(w, http.StatusOK, struct {
		Status  string  `json:"status"`
		Version string  `json:"version"`
		Commit  *string `json:"commit"`
	}{Status: "ok", Version: a.version, Commit: a.commit})
}

func (a *App) handleLevels(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	state, err := a.store.state(a.runID, a.version, a.commit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "interner Fehler")
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (a *App) handleLevel(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	n, ok := parseLevel(r.PathValue("n"))
	if !ok {
		writeError(w, http.StatusNotFound, "unbekanntes Level")
		return
	}
	lvl, err := a.store.level(n, a.runID, a.version, a.commit)
	if err != nil {
		writeError(w, http.StatusNotFound, "unbekanntes Level")
		return
	}
	writeJSON(w, http.StatusOK, lvl)
}

type ResultReport struct {
	Checks     []Check         `json:"checks"`
	DurationMs *int64          `json:"durationMs"`
	Metrics    json.RawMessage `json:"metrics"`
}

func (a *App) handleResult(w http.ResponseWriter, r *http.Request) {
	n, ok := parseLevel(r.PathValue("n"))
	if !ok {
		writeError(w, http.StatusNotFound, "unbekanntes Level")
		return
	}
	if r.Method != http.MethodPost {
		methodNotAllowed(w, "POST")
		return
	}
	if !isJSONContentType(r.Header.Get("Content-Type")) {
		writeError(w, http.StatusUnsupportedMediaType, "Content-Type muss application/json sein")
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 65537))
	if err != nil {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	if len(body) > 65536 {
		writeError(w, http.StatusRequestEntityTooLarge, "Body zu groß")
		return
	}

	dec := json.NewDecoder(bytes.NewReader(body))
	dec.DisallowUnknownFields()
	var rep ResultReport
	if err := dec.Decode(&rep); err != nil {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	if dec.More() {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}

	if rep.DurationMs == nil || *rep.DurationMs < 0 {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	if len(rep.Checks) < 1 || len(rep.Checks) > 100 {
		writeError(w, http.StatusBadRequest, "ungültige Anfrage")
		return
	}
	for _, c := range rep.Checks {
		if c.Name == "" {
			writeError(w, http.StatusBadRequest, "ungültige Anfrage")
			return
		}
	}

	metrics := rep.Metrics
	if len(metrics) > 0 && string(metrics) != "null" {
		var obj map[string]json.RawMessage
		if err := json.Unmarshal(metrics, &obj); err != nil {
			writeError(w, http.StatusBadRequest, "ungültige Anfrage")
			return
		}
	}

	status, _, err := a.store.postResult(n, rep.Checks, *rep.DurationMs, metrics)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "interner Fehler")
		return
	}
	if status == 409 {
		writeError(w, http.StatusConflict, "ein niedrigeres Level ist nicht bestanden")
		return
	}

	state, err := a.store.state(a.runID, a.version, a.commit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "interner Fehler")
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (a *App) handleHistory(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w, "GET")
		return
	}
	n, ok := parseLevel(r.PathValue("n"))
	if !ok {
		writeError(w, http.StatusNotFound, "unbekanntes Level")
		return
	}

	limit := 50
	if q := r.URL.Query().Get("limit"); q != "" {
		v, err := strconv.Atoi(q)
		if err != nil || v < 1 || v > 500 {
			writeError(w, http.StatusBadRequest, "ungültiges limit")
			return
		}
		limit = v
	}

	hist, err := a.store.history(n, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "interner Fehler")
		return
	}
	writeJSON(w, http.StatusOK, hist)
}

func (a *App) handleUsage(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		raw, err := a.store.getUsage()
		if err != nil {
			writeError(w, http.StatusInternalServerError, "interner Fehler")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(raw)
	case http.MethodPut:
		if !isJSONContentType(r.Header.Get("Content-Type")) {
			writeError(w, http.StatusUnsupportedMediaType, "Content-Type muss application/json sein")
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, 65537))
		if err != nil {
			writeError(w, http.StatusBadRequest, "ungültiges JSON")
			return
		}
		if len(body) > 65536 {
			writeError(w, http.StatusRequestEntityTooLarge, "Body zu groß")
			return
		}
		trimmed := bytes.TrimSpace(body)
		if !json.Valid(trimmed) {
			writeError(w, http.StatusBadRequest, "ungültiges JSON")
			return
		}
		var obj map[string]json.RawMessage
		if err := json.Unmarshal(trimmed, &obj); err != nil {
			writeError(w, http.StatusBadRequest, "kein JSON-Objekt")
			return
		}
		raw, err := a.store.putUsage(trimmed)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "interner Fehler")
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(raw)
	default:
		methodNotAllowed(w, "GET, PUT")
	}
}
