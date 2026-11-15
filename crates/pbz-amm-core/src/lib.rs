// Copyright 2026 PBZ-AMM Contributors
// SPDX-License-Identifier: Apache-2.0

pub mod backup;
pub mod container;
pub mod deployer;
pub mod error;
pub mod game;
pub mod nexus;
pub mod scanner;
pub mod state;
pub mod telemetry;

#[cfg(test)]
mod tests {
    use crate::container::{find_container_conflicts, inspect_container};
    use crate::deployer::{InstallOptions, ModManager};
    use crate::error::{AmmError, ResponseStatus};
    use crate::game::{GameInstall, StorePlatform};
    use crate::nexus::NxmUri;
    use crate::scanner::sanitize_relative_path;
    use crate::state::VANILLA_PROFILE_ID;
    use std::fs::{self, File};
    use std::io::Write;
    use std::path::{Path, PathBuf};
    use zip::write::SimpleFileOptions;

    fn create_mock_pbz_game(root: &Path, store: &str) -> GameInstall {
        let exe_dir = root.join("platform").join(store);
        let paks_dir = root.join("ProjectPBZ").join("Content").join("Paks");
        let save_dir = root
            .join("ProjectPBZ")
            .join("Saved")
            .join("SaveGames")
            .join("Steam")
            .join("76561198000000001");
        fs::create_dir_all(&exe_dir).unwrap();
        fs::create_dir_all(&paks_dir).unwrap();
        fs::create_dir_all(&save_dir).unwrap();
        // Outer launcher stub (should never be picked over platform/<store>/PBZ.exe)
        fs::write(root.join("PBZ.exe"), b"stub").unwrap();
        // Real platform shipping binary
        fs::write(exe_dir.join("PBZ.exe"), b"shipping-binary-mock").unwrap();
        // Mock player save
        fs::write(save_dir.join("PBZSaveGame.sav"), b"PBZS-mock-save-v1").unwrap();

        GameInstall::from_root(root, true).unwrap()
    }

    fn write_zip(zip_path: &Path, entries: &[(&str, &[u8])]) {
        let f = File::create(zip_path).unwrap();
        let mut zw = zip::ZipWriter::new(f);
        let opts = SimpleFileOptions::default();
        for (name, bytes) in entries {
            zw.start_file(*name, opts).unwrap();
            zw.write_all(bytes).unwrap();
        }
        zw.finish().unwrap();
    }

    /// Build a valid synthetic UE5 IoStore `.utoc` v5 file with 12-byte FIoChunkId + unencrypted DirectoryIndex!
    fn build_synthetic_utoc(chunk_id: [u8; 12], mount_point: &str, dir_name: &str, file_name: &str) -> Vec<u8> {
        // Build FIoDirectoryIndexResource payload first:
        let mut dir_idx = Vec::new();
        push_fstring(&mut dir_idx, mount_point);
        // 2 DirectoryEntries: root (name=MAX, first_child=1, next_sib=MAX, first_file=MAX)
        //                     child (name=0, first_child=MAX, next_sib=MAX, first_file=0)
        dir_idx.extend_from_slice(&2u32.to_le_bytes());
        for val in [u32::MAX, 1, u32::MAX, u32::MAX] {
            dir_idx.extend_from_slice(&val.to_le_bytes());
        }
        for val in [0u32, u32::MAX, u32::MAX, 0] {
            dir_idx.extend_from_slice(&val.to_le_bytes());
        }
        // 1 FileEntry: (name=1, next_file=MAX, user_data=0)
        dir_idx.extend_from_slice(&1u32.to_le_bytes());
        for val in [1u32, u32::MAX, 0] {
            dir_idx.extend_from_slice(&val.to_le_bytes());
        }
        // StringTable: [dir_name, file_name]
        dir_idx.extend_from_slice(&2u32.to_le_bytes());
        push_fstring(&mut dir_idx, dir_name);
        push_fstring(&mut dir_idx, file_name);

        let mut buf = vec![0u8; 144];
        buf[0..16].copy_from_slice(b"-==--==--==--==-");
        buf[16] = 5; // UE5 IoStore TocVersion = 5
        buf[20..24].copy_from_slice(&144u32.to_le_bytes()); // HeaderSize
        buf[24..28].copy_from_slice(&1u32.to_le_bytes()); // TocEntryCount = 1
        buf[28..32].copy_from_slice(&0u32.to_le_bytes()); // CompressedBlockCount = 0
        buf[32..36].copy_from_slice(&12u32.to_le_bytes()); // CompressionBlockEntrySize = 12
        buf[48..52].copy_from_slice(&(dir_idx.len() as u32).to_le_bytes()); // DirectoryIndexSize
        buf[80] = 1 << 3; // ContainerFlags = Indexed (unencrypted, unsigned)

        // 1 FIoChunkId (12 bytes)
        buf.extend_from_slice(&chunk_id);
        // 1 FIoOffsetAndLength (10 bytes)
        buf.extend_from_slice(&[0u8; 10]);
        // DirectoryIndex bytes
        buf.extend_from_slice(&dir_idx);
        buf
    }

    fn push_fstring(out: &mut Vec<u8>, s: &str) {
        let len = (s.len() + 1) as u32;
        out.extend_from_slice(&len.to_le_bytes());
        out.extend_from_slice(s.as_bytes());
        out.push(0);
    }

    #[test]
    fn test_wegame_store_path_rewriting_and_locator() {
        let tmp = tempfile::tempdir().unwrap();
        let game_root = tmp.path().join("PBZ");
        let game = create_mock_pbz_game(&game_root, "wegame");
        assert_eq!(game.store, StorePlatform::WeGame);
        assert_eq!(game.exe_dir, game_root.join("platform").join("wegame"));

        let data_dir = tmp.path().join("amm-data");
        let mut mgr = ModManager::open_for_tests(&data_dir).unwrap();

        // Author hardcoded `platform/steam/ue4ss/Mods/ParryHelper/Scripts/main.lua` in zip!
        let zip_path = tmp.path().join("ParryHelper-88-1-0-1700000000.zip");
        write_zip(
            &zip_path,
            &[(
                "PBZ/platform/steam/ue4ss/Mods/ParryHelper/Scripts/main.lua",
                b"print('parry')",
            )],
        );

        let installed = mgr
            .install_source(&game, &zip_path, &InstallOptions::default())
            .unwrap();
        assert_eq!(installed.nexus_mod_id, Some(88));
        // Must be deployed into `platform/wegame/ue4ss/Mods/ParryHelper/` + `enabled.txt`!
        assert!(
            game_root
                .join("platform/wegame/ue4ss/Mods/ParryHelper/Scripts/main.lua")
                .is_file()
        );
        assert!(
            game_root
                .join("platform/wegame/ue4ss/Mods/ParryHelper/enabled.txt")
                .is_file()
        );
    }

    #[test]
    fn test_zip_slip_traversal_blocked() {
        assert!(sanitize_relative_path("../../Windows/System32/evil.dll").is_err());
        assert!(sanitize_relative_path("C:\\Windows\\evil.dll").is_err());
        assert_eq!(
            sanitize_relative_path("ModA\\Scripts\\main.lua").unwrap(),
            PathBuf::from("ModA").join("Scripts").join("main.lua")
        );
    }

    #[test]
    fn test_multi_variant_stops_and_selects() {
        let tmp = tempfile::tempdir().unwrap();
        let game = create_mock_pbz_game(&tmp.path().join("PBZ"), "steam");
        let mut mgr = ModManager::open_for_tests(tmp.path().join("data")).unwrap();

        let zip_path = tmp.path().join("BaiChilian.zip");
        write_zip(
            &zip_path,
            &[
                ("ShortHair/Chilian_P.pak", b"short-pak"),
                ("LongHair/Chilian_P.pak", b"long-pak"),
            ],
        );

        // Installing without `--select` MUST pause with NeedsSelection (exit code 10)
        let err = mgr
            .install_source(&game, &zip_path, &InstallOptions::default())
            .unwrap_err();
        assert_eq!(err.status(), ResponseStatus::NeedsSelection);
        if let AmmError::NeedsSelection(prompt) = err {
            assert_eq!(prompt.available_variants, vec!["LongHair", "ShortHair"]);
        } else {
            panic!("Expected NeedsSelection");
        }

        // Selecting `LongHair` succeeds cleanly
        let opts = InstallOptions {
            select_variant: Some("LongHair".to_string()),
            ..Default::default()
        };
        mgr.install_source(&game, &zip_path, &opts).unwrap();
        let deployed_pak = game.tilde_mods_dir.join("Chilian_P.pak");
        assert_eq!(fs::read(&deployed_pak).unwrap(), b"long-pak");
    }

    #[test]
    fn test_utoc_iostore_asset_and_chunk_conflict_detection() {
        let tmp = tempfile::tempdir().unwrap();
        let shared_chunk = [0xAA, 0xBB, 0xCC, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x01];

        let utoc1 = tmp.path().join("SkinA_P.utoc");
        let utoc2 = tmp.path().join("SkinB_P.utoc");
        fs::write(
            &utoc1,
            build_synthetic_utoc(
                shared_chunk,
                "../../../ProjectPBZ/Content/",
                "Characters/Soul",
                "SK_Soul.uasset",
            ),
        )
        .unwrap();
        fs::write(
            &utoc2,
            build_synthetic_utoc(
                shared_chunk,
                "../../../ProjectPBZ/Content/",
                "Characters/Soul",
                "SK_Soul.uasset",
            ),
        )
        .unwrap();

        let idx1 = inspect_container(&utoc1);
        let idx2 = inspect_container(&utoc2);
        assert!(
            idx1.asset_paths
                .contains(&"projectpbz/content/characters/soul/sk_soul.uasset".to_string())
        );

        let conflicts = find_container_conflicts(&[
            ("SkinA".to_string(), vec![idx1]),
            ("SkinB".to_string(), vec![idx2]),
        ]);
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].overlapping_chunks, 1);
        assert_eq!(
            conflicts[0].overlapping_assets,
            vec!["projectpbz/content/characters/soul/sk_soul.uasset"]
        );
    }

    #[test]
    fn test_update_preserves_user_config_and_supports_rollback_and_profiles() {
        let tmp = tempfile::tempdir().unwrap();
        let game = create_mock_pbz_game(&tmp.path().join("PBZ"), "steam");
        // Place an unmanaged file in ~mods to verify PBZ-AMM NEVER touches it!
        fs::create_dir_all(&game.tilde_mods_dir).unwrap();
        let wild_file = game.tilde_mods_dir.join("WildUntouched.pak");
        fs::write(&wild_file, b"keep-me-safe").unwrap();

        let mut mgr = ModManager::open_for_tests(tmp.path().join("data")).unwrap();

        // Install v1.0 of a UE4SS mod with config.lua
        let v1_zip = tmp.path().join("AutoExec_v1.zip");
        write_zip(
            &v1_zip,
            &[
                ("AutoExec/Scripts/main.lua", b"-- v1 code"),
                ("AutoExec/Scripts/config.lua", b"hotkey = 'F6'"),
            ],
        );
        let m1 = mgr
            .install_source(
                &game,
                &v1_zip,
                &InstallOptions {
                    name_override: Some("AutoExec".to_string()),
                    version_override: Some("1.0.0".to_string()),
                    ..Default::default()
                },
            )
            .unwrap();

        // Player customizes config.lua in-game/manually
        let live_cfg = game.ue4ss_mods_dir.join("AutoExec/Scripts/config.lua");
        fs::write(&live_cfg, b"hotkey = 'F9' -- user custom").unwrap();

        // Update to v2.0 -> user's custom config.lua MUST be preserved, while main.lua updates to v2!
        let v2_zip = tmp.path().join("AutoExec_v2.zip");
        write_zip(
            &v2_zip,
            &[
                ("AutoExec/Scripts/main.lua", b"-- v2 code"),
                ("AutoExec/Scripts/config.lua", b"hotkey = 'F6'"),
            ],
        );
        mgr.install_source(
            &game,
            &v2_zip,
            &InstallOptions {
                name_override: Some("AutoExec".to_string()),
                version_override: Some("2.0.0".to_string()),
                ..Default::default()
            },
        )
        .unwrap();

        let live_main = game.ue4ss_mods_dir.join("AutoExec/Scripts/main.lua");
        assert_eq!(fs::read(&live_main).unwrap(), b"-- v2 code");
        assert_eq!(fs::read(&live_cfg).unwrap(), b"hotkey = 'F9' -- user custom");

        // Switch to `vanilla` profile -> managed mod removed, wild file & SaveGames untouched!
        mgr.switch_profile(&game, VANILLA_PROFILE_ID).unwrap();
        assert!(!live_main.exists());
        assert_eq!(fs::read(&wild_file).unwrap(), b"keep-me-safe");
        assert!(
            game.save_games_dir
                .join("Steam/76561198000000001/PBZSaveGame.sav")
                .is_file()
        );

        // Switch back to `default` and rollback v2 -> v1!
        mgr.switch_profile(&game, "default").unwrap();
        assert_eq!(fs::read(&live_main).unwrap(), b"-- v2 code");
        let rolled = mgr.rollback_mod(&game, &m1.id).unwrap();
        assert_eq!(rolled.current.version, "1.0.0");
        assert_eq!(fs::read(&live_main).unwrap(), b"-- v1 code");
    }

    #[test]
    fn test_save_backup_quota_and_confirmed_restore() {
        let tmp = tempfile::tempdir().unwrap();
        let game = create_mock_pbz_game(&tmp.path().join("PBZ"), "steam");
        let save_file = game
            .save_games_dir
            .join("Steam/76561198000000001/PBZSaveGame.sav");

        let mut mgr = ModManager::open_for_tests(tmp.path().join("data")).unwrap();
        mgr.state.backup_policy.max_auto_backups = 2;

        // Create 1 pinned backup before boss
        let pinned = mgr
            .manual_backup(&game, Some("Before Final Boss".to_string()), true)
            .unwrap()
            .unwrap();

        // Corrupt/advance live save and make 3 unpinned backups -> pinned MUST survive!
        fs::write(&save_file, b"corrupted-save-data").unwrap();
        for _ in 0..3 {
            mgr.manual_backup(&game, None, false).unwrap();
        }
        assert!(mgr.state.save_backups.iter().any(|b| b.id == pinned.id));

        // Restore without confirmation MUST fail with NeedsSelection
        let err = mgr.restore_backup(&game, &pinned.id, false).unwrap_err();
        assert_eq!(err.status(), ResponseStatus::NeedsSelection);

        // Restore WITH confirmation restores original bytes cleanly
        mgr.restore_backup(&game, &pinned.id, true).unwrap();
        assert_eq!(fs::read(&save_file).unwrap(), b"PBZS-mock-save-v1");
    }

    #[test]
    fn test_nxm_uri_parsing() {
        let uri = NxmUri::parse(
            "nxm://phantombladezero/mods/149/files/9876?key=abc123XYZ&expires=1790000000&user_id=42",
        )
        .unwrap();
        assert_eq!(uri.domain, "phantombladezero");
        assert_eq!(uri.mod_id, 149);
        assert_eq!(uri.file_id, 9876);
        assert_eq!(uri.key.as_deref(), Some("abc123XYZ"));
        assert_eq!(uri.expires.as_deref(), Some("1790000000"));
    }
}
