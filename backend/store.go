package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var titles = []string{
	"Statische Seite",
	"Webserver",
	"REST-Backend",
	"Datenbank",
	"Frontend + Backend",
	"Repo + CI",
	"Images in der Pipeline",
	"Deployment",
	"Live-Prüfung",
	"Metriken veröffentlicht",
}

type Check struct {
	Name string `json:"name"`
	Ok   bool   `json:"ok"`
}

type LevelJSON struct {
	Level      int             `json:"level"`
	Title      string          `json:"title"`
	Status     string          `json:"status"`
	CheckedAt  *string         `json:"checkedAt"`
	DurationMs *int64          `json:"durationMs"`
	Checks     []Check         `json:"checks"`
	Metrics    json.RawMessage `json:"metrics"`
}

type RunJSON struct {
	ID        string  `json:"id"`
	Version   string  `json:"version"`
	Commit    *string `json:"commit"`
	UpdatedAt *string `json:"updatedAt"`
}

type ResultsJSON struct {
	Run    RunJSON     `json:"run"`
	Levels []LevelJSON `json:"levels"`
}

type Store struct {
	db      *sql.DB
	dir     string
	usageMu sync.Mutex
}

func openStore(dbPath string) (*Store, error) {
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	dsn := fmt.Sprintf(
		"file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)",
		dbPath,
	)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db: db, dir: dir}
	if err := s.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func (s *Store) Close() error {
	return s.db.Close()
}

func (s *Store) migrate() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var uv int
	if err := tx.QueryRow("PRAGMA user_version").Scan(&uv); err != nil {
		return err
	}
	if uv == 0 {
		stmts := []string{
			`CREATE TABLE levels (
  level        INTEGER PRIMARY KEY CHECK (level BETWEEN 1 AND 10),
  status       TEXT    NOT NULL CHECK (status IN ('offen','bestanden','fehlgeschlagen','gesperrt')),
  checked_at   TEXT,
  duration_ms  INTEGER,
  checks       TEXT    NOT NULL DEFAULT '[]',
  metrics      TEXT    NOT NULL DEFAULT '{}'
)`,
			`CREATE TABLE reports (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  level        INTEGER NOT NULL REFERENCES levels(level),
  status       TEXT    NOT NULL CHECK (status IN ('bestanden','fehlgeschlagen')),
  checked_at   TEXT    NOT NULL,
  duration_ms  INTEGER NOT NULL,
  checks       TEXT    NOT NULL,
  metrics      TEXT    NOT NULL
)`,
			`CREATE INDEX reports_level ON reports(level, id)`,
			`CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT)`,
		}
		for _, stmt := range stmts {
			if _, err := tx.Exec(stmt); err != nil {
				return err
			}
		}
		for i := 1; i <= 10; i++ {
			if _, err := tx.Exec("INSERT INTO levels (level, status) VALUES (?, 'offen')", i); err != nil {
				return err
			}
		}
		if _, err := tx.Exec("PRAGMA user_version = 1"); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func isoNow() string {
	t := time.Now().UTC()
	return fmt.Sprintf("%04d-%02d-%02dT%02d:%02d:%02d.%03dZ",
		t.Year(), int(t.Month()), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond()/1e6)
}

func parseRaw(s string) json.RawMessage {
	if s == "" {
		s = "{}"
	}
	return json.RawMessage(s)
}

func (s *Store) state(runID, version string, commit *string) (*ResultsJSON, error) {
	var updatedAtVal sql.NullString
	err := s.db.QueryRow("SELECT value FROM meta WHERE key = 'updated_at'").Scan(&updatedAtVal)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	var updatedAt *string
	if updatedAtVal.Valid {
		updatedAt = &updatedAtVal.String
	}

	rows, err := s.db.Query("SELECT level, status, checked_at, duration_ms, checks, metrics FROM levels ORDER BY level")
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	levels := make([]LevelJSON, 0, 10)
	for rows.Next() {
		var lv int
		var status string
		var checkedAt sql.NullString
		var durationMs sql.NullInt64
		var checks, metrics string
		if err := rows.Scan(&lv, &status, &checkedAt, &durationMs, &checks, &metrics); err != nil {
			return nil, err
		}
		l := LevelJSON{
			Level:   lv,
			Title:   titles[lv-1],
			Status:  status,
			Checks:  []Check{},
			Metrics: parseRaw(metrics),
		}
		if checkedAt.Valid {
			v := checkedAt.String
			l.CheckedAt = &v
		}
		if durationMs.Valid {
			v := durationMs.Int64
			l.DurationMs = &v
		}
		if checks != "" && checks != "[]" {
			var cs []Check
			if err := json.Unmarshal([]byte(checks), &cs); err != nil {
				return nil, err
			}
			l.Checks = cs
		}
		levels = append(levels, l)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &ResultsJSON{
		Run: RunJSON{ID: runID, Version: version, Commit: commit, UpdatedAt: updatedAt},
		Levels: levels,
	}, nil
}

// postResult meldet ein Ergebnis. Rückgabe: HTTP-Status (200 oder 409).
func (s *Store) postResult(n int, checks []Check, durationMs int64, metrics json.RawMessage) (int, *ResultsJSON, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return 500, nil, err
	}
	defer tx.Rollback()

	var bestanden int
	if err := tx.QueryRow(
		"SELECT COUNT(*) FROM levels WHERE level < ? AND status = 'bestanden'", n,
	).Scan(&bestanden); err != nil {
		return 500, nil, err
	}
	if bestanden != n-1 {
		return 409, nil, nil
	}

	status := "bestanden"
	for _, c := range checks {
		if !c.Ok {
			status = "fehlgeschlagen"
			break
		}
	}

	checksJSON, err := json.Marshal(checks)
	if err != nil {
		return 500, nil, err
	}
	metricsJSON := metrics
	if len(metricsJSON) == 0 || string(metricsJSON) == "null" {
		metricsJSON = json.RawMessage("{}")
	}

	now := isoNow()

	if _, err := tx.Exec(
		"UPDATE levels SET status = ?, checked_at = ?, duration_ms = ?, checks = ?, metrics = ? WHERE level = ?",
		status, now, durationMs, string(checksJSON), string(metricsJSON), n,
	); err != nil {
		return 500, nil, err
	}

	clearStatus := "offen"
	if status != "bestanden" {
		clearStatus = "gesperrt"
	}
	if _, err := tx.Exec(
		"UPDATE levels SET status = ?, checked_at = NULL, duration_ms = NULL, checks = '[]', metrics = '{}' WHERE level > ?",
		clearStatus, n,
	); err != nil {
		return 500, nil, err
	}

	if _, err := tx.Exec(
		"INSERT INTO reports (level, status, checked_at, duration_ms, checks, metrics) VALUES (?, ?, ?, ?, ?, ?)",
		n, status, now, durationMs, string(checksJSON), string(metricsJSON),
	); err != nil {
		return 500, nil, err
	}

	if _, err := tx.Exec(
		"INSERT INTO meta (key, value) VALUES ('updated_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
		now,
	); err != nil {
		return 500, nil, err
	}

	if err := tx.Commit(); err != nil {
		return 500, nil, err
	}

	return 200, nil, nil
}

func (s *Store) level(n int, runID, version string, commit *string) (*LevelJSON, error) {
	var status string
	var checkedAt sql.NullString
	var durationMs sql.NullInt64
	var checks, metrics string
	err := s.db.QueryRow(
		"SELECT status, checked_at, duration_ms, checks, metrics FROM levels WHERE level = ?", n,
	).Scan(&status, &checkedAt, &durationMs, &checks, &metrics)
	if err != nil {
		return nil, err
	}
	l := &LevelJSON{
		Level:   n,
		Title:   titles[n-1],
		Status:  status,
		Checks:  []Check{},
		Metrics: parseRaw(metrics),
	}
	if checkedAt.Valid {
		v := checkedAt.String
		l.CheckedAt = &v
	}
	if durationMs.Valid {
		v := durationMs.Int64
		l.DurationMs = &v
	}
	if checks != "" && checks != "[]" {
		var cs []Check
		if err := json.Unmarshal([]byte(checks), &cs); err != nil {
			return nil, err
		}
		l.Checks = cs
	}
	return l, nil
}

type HistoryEntryJSON struct {
	ID         int64           `json:"id"`
	Status     string          `json:"status"`
	CheckedAt  string          `json:"checkedAt"`
	DurationMs int64           `json:"durationMs"`
	Checks     []Check         `json:"checks"`
	Metrics    json.RawMessage `json:"metrics"`
}

type HistoryJSON struct {
	Level   int                `json:"level"`
	Entries []HistoryEntryJSON `json:"entries"`
}

func (s *Store) history(n, limit int) (*HistoryJSON, error) {
	rows, err := s.db.Query(
		"SELECT id, status, checked_at, duration_ms, checks, metrics FROM reports WHERE level = ? ORDER BY id DESC LIMIT ?",
		n, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := make([]HistoryEntryJSON, 0)
	for rows.Next() {
		var id int64
		var status, checkedAt, checks, metrics string
		var durationMs int64
		if err := rows.Scan(&id, &status, &checkedAt, &durationMs, &checks, &metrics); err != nil {
			return nil, err
		}
		e := HistoryEntryJSON{
			ID:         id,
			Status:     status,
			CheckedAt:  checkedAt,
			DurationMs: durationMs,
			Checks:     []Check{},
			Metrics:    parseRaw(metrics),
		}
		if checks != "" && checks != "[]" {
			var cs []Check
			if err := json.Unmarshal([]byte(checks), &cs); err != nil {
				return nil, err
			}
			e.Checks = cs
		}
		entries = append(entries, e)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &HistoryJSON{Level: n, Entries: entries}, nil
}

func (s *Store) usagePath() string {
	return filepath.Join(s.dir, "usage.json")
}

func (s *Store) getUsage() (json.RawMessage, error) {
	b, err := os.ReadFile(s.usagePath())
	if err != nil {
		if os.IsNotExist(err) {
			return json.RawMessage("{}"), nil
		}
		return nil, err
	}
	return json.RawMessage(b), nil
}

func (s *Store) putUsage(raw json.RawMessage) (json.RawMessage, error) {
	s.usageMu.Lock()
	defer s.usageMu.Unlock()
	tmp := s.usagePath() + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o644); err != nil {
		return nil, err
	}
	if err := os.Rename(tmp, s.usagePath()); err != nil {
		return nil, err
	}
	return raw, nil
}
