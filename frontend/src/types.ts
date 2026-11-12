export interface ConnectionForm {
  name: string;
  group: string;
  host: string;
  port: number;
  username: string;
  password: string;
  db: number;
  useTLS: boolean;
  profileID?: string;
}

export interface SavedConnection {
  id: string;
  name: string;
  group: string;
  host: string;
  port: number;
  username: string;
  password: string;
  db: number;
  useTLS: boolean;
}

export interface SidebarConnection {
  id: string;
  name: string;
  group: string;
  address: string;
  version: string;
  connected: boolean;
}

export interface ConnectionInfo {
  id: string;
  name: string;
  address: string;
  version: string;
}

export interface DatabaseInfo {
  index: number;
  keys: number;
}

export interface KeyInfo {
  key: string;
  type: string;
  ttl: number;
}

export interface ScanResult {
  keys: KeyInfo[];
  cursor: string;
  hasMore: boolean;
}

export interface Entry {
  field: string;
  value: string;
}

export interface EditPayload {
  action: string;
  field?: string;
  value?: string;
  score?: number;
  index?: number;
}

export interface CreateKeyItem {
  field: string;
  value: string;
  score: number;
}

export interface CreateKeyForm {
  key: string;
  type: string;
  ttl: number;
  field: string;
  value: string;
  score: number;
  index: number;
  items: CreateKeyItem[];
}

export interface ValueResult {
  key: string;
  type: string;
  ttl: number;
  value: string;
  length: number;
  info: Entry[];
  entries: Entry[];
  entryKind: string;
  truncated: boolean;
  editable: boolean;
}

export interface DatabaseStatus {
  index: number;
  keys: number;
  expires: number;
  avgTTL: number;
}

export interface CommandStat {
  name: string;
  calls: number;
}

export interface SlowQuery {
  id: number;
  time: number;
  durationMs: number;
  summary: string;
  command: string;
  clientAddr: string;
}

export interface SlowLogData {
  entries: SlowQuery[];
  thresholdMs: number;
  maxLen: number;
  total: number;
}

export interface CommandResult {
  display: string;
  isError: boolean;
  durationMs: number;
  errorCode: string;
}

export interface InstanceStatus {
  name: string;
  address: string;
  version: string;
  mode: string;
  role: string;
  os: string;
  archBits: string;
  processID: number;
  uptimeSeconds: number;
  usedMemory: number;
  usedMemoryHuman: string;
  usedMemoryPeakHuman: string;
  usedMemoryRSSHuman: string;
  memoryFragmentation: number;
  maxMemory: number;
  maxClients: number;
  connectedClients: number;
  blockedClients: number;
  totalConnectionsReceived: number;
  totalCommandsProcessed: number;
  instantaneousOpsPerSec: number;
  keyspaceHits: number;
  keyspaceMisses: number;
  hitRate: number;
  expiredKeys: number;
  evictedKeys: number;
  rejectedConnections: number;
  rdbLastSaveTime: number;
  rdbInProgress: boolean;
  aofEnabled: boolean;
  aofLastWrite: string;
  aofCurrentSize: number;
  connectedSlaves: number;
  maxReplicaLag: number;
  masterHost: string;
  masterPort: number;
  masterLinkStatus: string;
  commands: CommandStat[];
  commandTotalCalls: number;
  slowQueries: SlowQuery[];
  slowlogThresholdMs: number;
  slowlogCount: number;
  databases: DatabaseStatus[];
}

export interface SubscriptionInfo {
  id: string;
  kind: "channel" | "pattern" | string;
  target: string;
  messages: number;
}

export interface PubSubMessage {
  connectionId: string;
  subscriptionId: string;
  channel: string;
  pattern: string;
  payload: string;
  timestamp: number;
}

export interface TypeSummary {
  type: string;
  keys: number;
  memory: number;
}

export interface NamespaceSummary {
  namespace: string;
  types: string[];
  keys: number;
  memory: number;
}

export interface KeyAnalysisItem {
  key: string;
  type: string;
  ttl: number;
  size: number;
  length: number;
}

export interface KeyAnalysis {
  totalKeys: number;
  totalMemory: number;
  types: TypeSummary[];
  namespaces: NamespaceSummary[];
  topByMemory: KeyAnalysisItem[];
  topByLength: KeyAnalysisItem[];
  truncated: boolean;
}
