"""Compatibility entry point for the native offline runtime archiver."""

from pathlib import Path
import runpy

runpy.run_path(str(Path(__file__).with_name("build-offline-runtime.py")), run_name="__main__")
