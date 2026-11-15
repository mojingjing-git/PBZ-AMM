export type ResponseStatus = "ok" | "needs_selection" | "blocked" | "error";

export interface SelectionPrompt {
  reason: string;
  available_variants: string[];
  conflicts: string[];
  uncertain_files: string[];
}

export interface UiEnvelope<T = any> {
  status: ResponseStatus;
  data?: T;
  selection?: SelectionPrompt;
  error?: string;
}

export interface GameInstall {
  root_dir: string;
  store: string | { custom: string };
  exe_dir: string;
  shipping_exe: string;
  tilde_mods_dir: string;
  logic_mods_dir: string;
  ue4ss_mods_dir: string;
  save_games_dir: string;
}

export interface InstalledFrameworks {
  ue4ss: boolean;
  mods_menu: boolean;
  pbz_mod_loader: boolean;
  cpp_pak_bypass: boolean;
  outfit_framework: boolean;
  occupied_proxy_dlls: string[];
}

export interface StagedFileEntry {
  source_rel: string;
  target: string;
  target_rel: string;
  size_bytes: number;
  sha256: string;
  is_user_config: boolean;
  uncertain: boolean;
}

export interface ContainerIndex {
  container_name: string;
  format: string;
  encrypted: boolean;
  mount_point?: string;
  asset_paths: string[];
  chunk_ids: string[];
  notes: string[];
}

export interface ModVersionData {
  version: string;
  variant_name: string;
  categories: string[];
  files: StagedFileEntry[];
  containers: ContainerIndex[];
  has_ue4ss_cpp_dll: boolean;
  installed_at: string;
}

export interface InstalledMod {
  id: string;
  name: string;
  nexus_mod_id?: number | null;
  latest_remote_version?: string | null;
  current: ModVersionData;
  previous?: ModVersionData | null;
}

export interface ProfileEntry {
  mod_id: string;
  enabled: boolean;
  priority: number;
}

export interface ModProfile {
  id: string;
  display_name: string;
  description: string;
  entries: ProfileEntry[];
}

export interface UnmanagedCandidate {
  id: string;
  name: string;
  target: string;
  game_rel_paths: string[];
  total_bytes: number;
}

export interface SaveBackupRecord {
  id: string;
  created_at: string;
  trigger_reason: string;
  note?: string | null;
  pinned: boolean;
  archive_name: string;
  size_bytes: number;
  sha256: string;
  file_count: number;
}

export interface DashboardData {
  data_dir: string;
  cli_exe: string;
  game?: GameInstall | null;
  game_missing_reason?: string | null;
  frameworks?: InstalledFrameworks | null;
  active_profile_id: string;
  profiles: Record<string, ModProfile>;
  mods: Record<string, InstalledMod>;
  unmanaged: UnmanagedCandidate[];
  conflict_messages: string[];
  save_backups: SaveBackupRecord[];
  has_nexus_key: boolean;
}

export interface ScannedVariant {
  name: string;
  categories: string[];
  files: StagedFileEntry[];
  containers: ContainerIndex[];
  has_ue4ss_cpp_dll: boolean;
  warnings: string[];
  problems: string[];
}

export interface InspectPayload {
  source_path: string;
  report: {
    suggested_name: string;
    nexus_mod_id_hint?: number | null;
    variants: ScannedVariant[];
    requires_variant_choice: boolean;
    ignored_executables: string[];
  };
  conflict_texts: Record<string, string[]>;
}

export interface NexusModSummary {
  mod_id: number;
  name: string;
  summary: string;
  version: string;
  author: string;
  downloads: number;
  category?: string | null;
  page_url: string;
}
