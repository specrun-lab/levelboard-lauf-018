package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{ResponseWriter: w, status: 200}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d", r.Method, r.URL.RequestURI(), rec.status)
	})
}

func main() {
	addr := os.Getenv("LEVELBOARD_ADDR")
	if addr == "" {
		addr = "127.0.0.1:8081"
	}
	dbPath := os.Getenv("LEVELBOARD_DB")
	if dbPath == "" {
		dbPath = ".run/levelboard.db"
	}
	runID := os.Getenv("RUN_ID")
	if runID == "" {
		runID = "lokal"
	}
	commit := os.Getenv("LEVELBOARD_COMMIT")
	var commitPtr *string
	if commit != "" {
		commitPtr = &commit
	}

	store, err := openStore(dbPath)
	if err != nil {
		log.Fatalf("Datenbank: %v", err)
	}
	defer store.Close()

	app := &App{store: store, runID: runID, version: "0.1.0", commit: commitPtr}

	srv := &http.Server{
		Addr:    addr,
		Handler: logRequests(app.routes()),
	}

	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Fatalf("Server: %v", err)
		}
	}()

	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("Shutdown: %v", err)
	}
}
