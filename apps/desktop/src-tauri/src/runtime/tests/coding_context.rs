use super::*;

#[tokio::test]
async fn real_git_switch_preserves_changes_and_handles_unborn_detached_and_worktrees() {
    let _ = process_manager::ProcessManager::init();
    let root = crate::paths::plain_path(
        &std::env::temp_dir().join(format!("hermess-git-{}", uuid::Uuid::new_v4())),
    );
    let repo = root.join("project 空格");
    let hooks = root.join("empty-hooks");
    fs::create_dir_all(&repo).unwrap();
    fs::create_dir_all(&hooks).unwrap();
    assert_eq!(read(&repo, &hooks).await.unwrap().state, "not_repository");
    let output = git(&repo, &hooks, &["init", "-b", "main"]).await.unwrap();
    assert!(output.status.success());
    let empty = read(&repo, &hooks).await.unwrap();
    assert_eq!(empty.branch.as_deref(), Some("main"));
    assert!(empty.branches.is_empty());
    assert!(switch(&repo, &hooks, "missing").await.is_err());
    fs::write(repo.join("tracked.txt"), "main content").unwrap();
    assert!(git(&repo, &hooks, &["add", "tracked.txt"])
        .await
        .unwrap()
        .status
        .success());
    assert!(git(
        &repo,
        &hooks,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgSign=false",
            "commit",
            "-m",
            "initial"
        ]
    )
    .await
    .unwrap()
    .status
    .success());
    assert!(git(&repo, &hooks, &["tag", "main"])
        .await
        .unwrap()
        .status
        .success());
    assert_eq!(
        read(&repo, &hooks).await.unwrap().branch.as_deref(),
        Some("main")
    );
    fs::write(
        repo.join(".git/hooks/post-checkout"),
        "#!/bin/sh\nexit 99\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(
            repo.join(".git/hooks/post-checkout"),
            fs::Permissions::from_mode(0o755),
        )
        .unwrap();
    }
    assert!(git(
        &repo,
        &hooks,
        &["branch", "feature/test", "refs/heads/main"]
    )
    .await
    .unwrap()
    .status
    .success());
    fs::create_dir_all(repo.join("nested")).unwrap();
    assert_eq!(
        switch(&repo.join("nested"), &hooks, "feature/test")
            .await
            .unwrap()
            .branch
            .as_deref(),
        Some("feature/test")
    );
    fs::write(repo.join("tracked.txt"), "feature content").unwrap();
    assert!(git(&repo, &hooks, &["add", "tracked.txt"])
        .await
        .unwrap()
        .status
        .success());
    assert!(git(
        &repo,
        &hooks,
        &[
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
            "-c",
            "commit.gpgSign=false",
            "commit",
            "-m",
            "feature"
        ]
    )
    .await
    .unwrap()
    .status
    .success());
    fs::write(repo.join("tracked.txt"), "uncommitted data").unwrap();
    let refused = switch(&repo, &hooks, "main").await.unwrap();
    assert_eq!(refused.switch_error, Some("rejected"));
    assert_eq!(refused.branch.as_deref(), Some("feature/test"));
    assert_eq!(
        fs::read_to_string(repo.join("tracked.txt")).unwrap(),
        "uncommitted data"
    );
    fs::write(repo.join("tracked.txt"), "feature content").unwrap();
    assert_eq!(
        switch(&repo, &hooks, "main")
            .await
            .unwrap()
            .branch
            .as_deref(),
        Some("main")
    );
    assert_eq!(
        fs::read_to_string(repo.join("tracked.txt")).unwrap(),
        "main content"
    );
    assert!(git(&repo, &hooks, &["checkout", "--detach", "HEAD"])
        .await
        .unwrap()
        .status
        .success());
    assert!(read(&repo, &hooks).await.unwrap().detached);
    assert!(!switch(&repo, &hooks, "main").await.unwrap().detached);
    let linked = root.join("linked");
    assert!(git(
        &repo,
        &hooks,
        &["worktree", "add", linked.to_str().unwrap(), "feature/test"]
    )
    .await
    .unwrap()
    .status
    .success());
    assert_eq!(
        read(&linked, &hooks).await.unwrap().branch.as_deref(),
        Some("feature/test")
    );
    assert_eq!(
        switch(&repo, &hooks, "feature/test")
            .await
            .unwrap()
            .switch_error,
        Some("rejected")
    );
    assert!(switch(&repo, &hooks, "--detach").await.is_err());
    fs::remove_dir_all(&root).unwrap();
}
