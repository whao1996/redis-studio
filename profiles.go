package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// ConnectionProfile 是持久化到用户配置目录的连接信息。
type ConnectionProfile struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Group    string `json:"group,omitempty"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	Username string `json:"username"`
	Password string `json:"password"`
	DB       int    `json:"db"`
	UseTLS   bool   `json:"useTLS"`
}

type profileFile struct {
	Version     int                 `json:"version"`
	Connections []ConnectionProfile `json:"connections"`
}

type profileStore struct {
	mu       sync.Mutex
	path     string
	profiles []ConnectionProfile
}

// defaultProfilePath 返回用户配置目录下的连接配置文件路径。
// macOS: ~/Library/Application Support/redis-studio/connections.json
// Windows: %AppData%\redis-studio\connections.json
// Linux: ~/.config/redis-studio/connections.json
func defaultProfilePath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "redis-studio", "connections.json"), nil
}

func newProfileStore(path string) (*profileStore, error) {
	if path == "" {
		resolved, err := defaultProfilePath()
		if err != nil {
			return &profileStore{}, err
		}
		path = resolved
	}

	store := &profileStore{path: path}
	if err := store.load(); err != nil {
		return store, err
	}
	return store, nil
}

func (s *profileStore) load() error {
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}

	var file profileFile
	if err := json.Unmarshal(data, &file); err != nil {
		return err
	}
	s.profiles = file.Connections
	return nil
}

func (s *profileStore) list() []ConnectionProfile {
	s.mu.Lock()
	defer s.mu.Unlock()

	out := make([]ConnectionProfile, len(s.profiles))
	copy(out, s.profiles)
	return out
}

func (s *profileStore) get(id string) (ConnectionProfile, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()

	for _, profile := range s.profiles {
		if profile.ID == id {
			return profile, true
		}
	}
	return ConnectionProfile{}, false
}

func (s *profileStore) upsert(profile ConnectionProfile) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	updated := false
	for i := range s.profiles {
		if s.profiles[i].ID == profile.ID {
			s.profiles[i] = profile
			updated = true
			break
		}
	}
	if !updated {
		s.profiles = append(s.profiles, profile)
	}

	return s.persistLocked()
}

func (s *profileStore) update(profile ConnectionProfile) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.profiles {
		if s.profiles[i].ID == profile.ID {
			s.profiles[i] = profile
			return s.persistLocked()
		}
	}
	return errors.New("connection profile not found")
}

func (s *profileStore) setGroup(id, group string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	for i := range s.profiles {
		if s.profiles[i].ID == id {
			s.profiles[i].Group = group
			return s.persistLocked()
		}
	}
	return errors.New("connection profile not found")
}

func (s *profileStore) remove(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	next := s.profiles[:0]
	for _, profile := range s.profiles {
		if profile.ID != id {
			next = append(next, profile)
		}
	}
	s.profiles = next

	return s.persistLocked()
}

func (s *profileStore) persistLocked() error {
	if s.path == "" {
		return errors.New("connection store path is not configured")
	}

	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(profileFile{Version: 1, Connections: s.profiles}, "", "  ")
	if err != nil {
		return err
	}

	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
