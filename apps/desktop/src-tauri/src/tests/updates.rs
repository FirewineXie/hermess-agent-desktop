use super::*;

fn release(asset: GithubAsset) -> GithubRelease {
    GithubRelease {
        tag_name: "v0.1.5-rc.2".into(),
        draft: false,
        prerelease: true,
        assets: vec![asset],
    }
}

fn installer() -> GithubAsset {
    let (prefix, extension) = asset_prefix().expect("supported test platform");
    let name = format!("{prefix}Hermess.Agent.Desktop_0.1.5-rc.2{extension}");
    GithubAsset {
        id: 42,
        name: name.clone(),
        size: 12 * 1024 * 1024,
        digest: Some(format!("sha256:{}", "a".repeat(64))),
        browser_download_url: format!(
            "https://github.com/{REPO}/releases/download/v0.1.5-rc.2/{name}"
        ),
        state: "uploaded".into(),
    }
}

#[test]
fn only_matching_published_release_with_verified_platform_asset_is_eligible() {
    let candidate = to_candidate(release(installer())).unwrap();
    assert!(candidate.eligible);
    assert_eq!(candidate.channel, "rc");
    assert_eq!(candidate.version, "0.1.5-rc.2");
    assert_eq!(candidate.asset.unwrap().sha256, "a".repeat(64));

    let mut missing_digest = installer();
    missing_digest.digest = None;
    assert!(!to_candidate(release(missing_digest)).unwrap().eligible);

    let mut wrong_platform = installer();
    wrong_platform.name = "linux-x64-Hermess.Agent.Desktop_0.1.5-rc.2.AppImage".into();
    assert!(!to_candidate(release(wrong_platform)).unwrap().eligible);

    let mut wrong_prerelease = release(installer());
    wrong_prerelease.prerelease = false;
    assert!(!to_candidate(wrong_prerelease).unwrap().eligible);
}

#[test]
fn installer_download_must_use_the_expected_github_release_path() {
    let asset = installer();
    assert!(trusted_download_url(&asset, "v0.1.5-rc.2"));

    let mut redirected = installer();
    redirected.browser_download_url = "https://example.org/installer.exe".into();
    assert!(!trusted_download_url(&redirected, "v0.1.5-rc.2"));

    let mut renamed = installer();
    renamed.browser_download_url.push_str("?download=1");
    assert!(!trusted_download_url(&renamed, "v0.1.5-rc.2"));
}
