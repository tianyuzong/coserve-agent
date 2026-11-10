"""Product-definition attachment helpers.

cadflow products (Part/Assembly) carry no durable ``Definition`` artifact —
the scene package is compiled straight from the product value.  These helpers
keep the runtime's call sites working: ``attached_definition`` reports that no
upstream definition is attached.
"""

from __future__ import annotations

from typing import Any


def attached_definition(product: Any) -> None:
    """cadflow products have no attached upstream definition."""

    return None


def attach_definition(product: Any, definition: Any) -> Any:
    """No-op: there is no definition to attach."""

    return product


def materialize_definition(product: Any) -> Any:
    return product


__all__ = ["attach_definition", "attached_definition", "materialize_definition"]
