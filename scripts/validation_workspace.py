"""Keep an isolated validation run's files only when something fails."""

from contextlib import contextmanager
from pathlib import Path
import shutil
import sys
import tempfile


@contextmanager
def validation_workspace(*, dir: Path, prefix: str):
    if not prefix or Path(prefix).name != prefix:
        raise ValueError("Validation workspace prefix must be a name, not a path")
    base = dir.resolve(strict=True)
    root = Path(tempfile.mkdtemp(dir=base, prefix=prefix))
    print(f"Validation workspace started: {root}", flush=True)
    try:
        yield str(root)
    except BaseException:
        print(f"Validation failed; workspace retained: {root}", file=sys.stderr, flush=True)
        raise
    else:
        try:
            if root.is_symlink() or root.is_junction() or root.resolve(strict=True) != root:
                raise RuntimeError(f"Refusing to remove a redirected validation workspace: {root}")
            shutil.rmtree(root)
        except (OSError, RuntimeError):
            print(f"Validation workspace cleanup failed: {root}", file=sys.stderr, flush=True)
            raise
        print(f"Validation workspace removed: {root}", flush=True)
