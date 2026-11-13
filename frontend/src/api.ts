import { RedisService } from "../bindings/redis-studio";
import type {
  CommandResult,
  ConnectionForm,
  ConnectionInfo,
  CreateKeyForm,
  DatabaseInfo,
  EditPayload,
  InstanceStatus,
  KeyAnalysis,
  SavedConnection,
  ScanResult,
  SlowLogData,
  SubscriptionInfo,
  ValueResult,
} from "./types";

function toPromise<T>(value: unknown): Promise<T> {
  return value as Promise<T>;
}

export const api = {
  connect: (form: ConnectionForm) =>
    toPromise<ConnectionInfo>(
      RedisService.Connect({
        name: form.name,
        group: form.group,
        host: form.host,
        port: form.port,
        username: form.username,
        password: form.password,
        db: form.db,
        useTLS: form.useTLS,
        profileID: form.profileID ?? "",
      })
    ),

  disconnect: (id: string) =>
    toPromise<void>(RedisService.Disconnect(id)),

  listSavedConnections: () =>
    toPromise<SavedConnection[]>(RedisService.ListSavedConnections()),

  deleteSavedConnection: (id: string) =>
    toPromise<void>(RedisService.DeleteSavedConnection(id)),

  updateSavedConnection: (profile: SavedConnection) =>
    toPromise<void>(
      RedisService.UpdateSavedConnection({
        id: profile.id,
        name: profile.name,
        group: profile.group,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        password: profile.password,
        db: profile.db,
        useTLS: profile.useTLS,
      })
    ),

  setConnectionGroup: (id: string, group: string) =>
    toPromise<void>(RedisService.SetConnectionGroup(id, group)),

  getInstanceStatus: (id: string) =>
    toPromise<InstanceStatus>(RedisService.GetInstanceStatus(id)),

  getSlowLog: (id: string, limit: number) =>
    toPromise<SlowLogData>(RedisService.GetSlowLog(id, limit)),

  clearSlowLog: (id: string) =>
    toPromise<void>(RedisService.ClearSlowLog(id)),

  getKeyAnalysis: (id: string, db: number, topN: number) =>
    toPromise<KeyAnalysis>(RedisService.GetKeyAnalysis(id, db, topN)),

  executeCommand: (id: string, db: number, command: string) =>
    toPromise<CommandResult>(RedisService.ExecuteCommand(id, db, command)),

  listCommands: (id: string) =>
    toPromise<string[]>(RedisService.ListCommands(id)),

  handleTitleBarDoubleClick: () =>
    toPromise<void>(RedisService.HandleTitleBarDoubleClick()),

  subscribe: (id: string, db: number, target: string, pattern: boolean) =>
    toPromise<SubscriptionInfo>(RedisService.Subscribe(id, db, target, pattern)),

  unsubscribe: (id: string, subscriptionID: string) =>
    toPromise<void>(RedisService.Unsubscribe(id, subscriptionID)),

  listSubscriptions: (id: string) =>
    toPromise<SubscriptionInfo[]>(RedisService.ListSubscriptions(id)),

  publish: (id: string, db: number, channel: string, message: string) =>
    toPromise<number>(RedisService.Publish(id, db, channel, message)),

  listDatabases: (id: string) =>
    toPromise<DatabaseInfo[]>(RedisService.ListDatabases(id)),

  scanKeys: (id: string, db: number, cursor: string, pattern: string, count: number) =>
    toPromise<ScanResult>(RedisService.ScanKeys(id, db, cursor, pattern, count)),

  scanAllKeys: (id: string, db: number, pattern: string) =>
    toPromise<ScanResult>(RedisService.ScanAllKeys(id, db, pattern)),

  getValue: (id: string, db: number, key: string) =>
    toPromise<ValueResult>(RedisService.GetValue(id, db, key)),

  setString: (id: string, db: number, key: string, value: string, ttlSeconds: number) =>
    toPromise<void>(RedisService.SetString(id, db, key, value, ttlSeconds)),

  deleteKey: (id: string, db: number, key: string) =>
    toPromise<void>(RedisService.DeleteKey(id, db, key)),

  setKeyTTL: (id: string, db: number, key: string, ttlSeconds: number) =>
    toPromise<void>(RedisService.SetKeyTTL(id, db, key, ttlSeconds)),

  edit: (id: string, db: number, key: string, payload: EditPayload) =>
    toPromise<void>(
      RedisService.Edit({
        id,
        db,
        key,
        action: payload.action,
        field: payload.field ?? "",
        value: payload.value ?? "",
        score: payload.score ?? 0,
        index: payload.index ?? 0,
      })
    ),

  createKey: (id: string, db: number, form: CreateKeyForm) =>
    toPromise<void>(
      RedisService.CreateKey({
        id,
        db,
        key: form.key,
        type: form.type,
        ttl: form.ttl,
        field: form.field,
        value: form.value,
        score: form.score,
        index: form.index,
        items: form.items,
      })
    ),
};
