"""Product -> cadflow-1.0 scene package.

``build_product_package`` compiles a Part/Assembly into a
``CompiledScenePackage``; ``encode_product_package`` serialises it to the
scene ZIP the CAStudio viewer loads (``cadflow-1.0``: bare ``scene.json`` +
content blobs, no ``package.json``).  The encode path mirrors cadflow's own
``export_scene``: thaw the immutable manifest, validate, write canonical ZIP.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from cadflow import compile_scene
from cadflow._engine.assembly.product import Assembly, Part
from cadflow._engine.exchange.scene.archive import canonical_zip_bytes
from cadflow._engine.exchange.scene.canonical import canonical_json_bytes
from cadflow._engine.exchange.scene.compiler import CompiledScenePackage, SceneRoot
from cadflow._engine.exchange.scene.validation import validate_scene_package


def _root_id(product: Any) -> str:
    if isinstance(product, Part):
        return product.part_id
    if isinstance(product, Assembly):
        return product.assembly_id
    raise TypeError(f"expected a Part or Assembly, got {type(product).__name__}")


def _thaw(value: Any) -> Any:
    """Recursively turn the package's immutable manifest into plain dict/list."""

    if isinstance(value, Mapping):
        return {key: _thaw(item) for key, item in value.items()}
    if isinstance(value, tuple):
        return [_thaw(item) for item in value]
    return value


def _validated(package: CompiledScenePackage) -> tuple[dict[str, Any], dict[str, bytes]]:
    manifest = _thaw(package.manifest)
    blobs = dict(package.blobs)
    report = validate_scene_package(manifest, blobs)
    if not report.valid:
        first = report.first_error
        raise ValueError(
            f"cannot export invalid scene package: {first.path} {first.code} {first.message}"
            if first is not None
            else "cannot export invalid scene package"
        )
    return manifest, blobs


def build_product_package(product: Any, *, validate: bool = False, scene_id: str | None = None) -> CompiledScenePackage:
    """Compile *product* (a cadflow Part or Assembly) into a scene package."""

    root_id = _root_id(product)
    package = compile_scene(
        scene_id=scene_id or root_id,
        roots=[SceneRoot(root_id=root_id, value=product)],
    )
    if validate:
        _validated(package)
    return package


def encode_product_package(package: CompiledScenePackage) -> bytes:
    """Serialise a ``CompiledScenePackage`` to scene-ZIP bytes."""

    if not isinstance(package, CompiledScenePackage):
        raise TypeError("package must be a CompiledScenePackage")
    manifest, blobs = _validated(package)
    return canonical_zip_bytes({"scene.json": canonical_json_bytes(manifest), **blobs})


__all__ = ["build_product_package", "encode_product_package"]
