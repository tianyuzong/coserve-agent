"""Find and return a notebook's product value.

A notebook's cells record into one shared cadflow ``GraphSession`` (see
:mod:`.executor`); the product is the top-level ``Part``/``Assembly`` whose
id is the notebook id (:func:`find_product`).  cadflow products carry no
durable ``Definition`` artifact — the scene package is compiled straight
from the product — so :func:`project_product` validates ownership and
returns the product unchanged.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Set as AbstractSet

from ..product.assembly import Assembly
from ..product.part import Part
from .cells import NotebookCells
from .config import NotebookConfig

Product = Part | Assembly


class ProductNotFoundError(ValueError):
    """No top-level value, or more than one, is the notebook's product."""


def _product_id(value: Product) -> str:
    return value.part_id if isinstance(value, Part) else value.assembly_id


def _as_product(value: object) -> Product | None:
    if isinstance(value, (Part, Assembly)):
        return value
    return None


def find_product(
    config: NotebookConfig,
    values: Mapping[str, object],
    read: AbstractSet[str] = frozenset(),
) -> Product:
    """Return the value in *values* (top-level names) with the notebook id.

    A ``PartBuildResult``/``AssemblyBuildResult`` counts as its value; one
    object bound to several names counts once.  An assembly built up over
    several cells has the notebook id in every cell; of several such
    values, the ones another cell reads (*read*: the names the cells
    reference) are intermediates, and the product is the one left.
    """

    matches: dict[int, tuple[str, Product]] = {}
    others: list[str] = []
    for name, value in values.items():
        product = _as_product(value)
        if product is None:
            continue
        if _product_id(product) == config.id:
            matches.setdefault(id(product), (name, product))
        else:
            others.append(f"{name} (id {_product_id(product)!r})")
    if len(matches) > 1:
        final = {key: match for key, match in matches.items() if match[0] not in read}
        if len(final) == 1:
            matches = final
    if len(matches) == 1:
        return next(iter(matches.values()))[1]
    if matches:
        names = sorted(name for name, _ in matches.values())
        raise ProductNotFoundError(
            f"{config.path.name}: several top-level values have the notebook "
            f"id {config.id!r} and none is the only one no other cell reads: "
            f"{', '.join(names)}"
        )
    found = ", ".join(sorted(others)) if others else "none"
    raise ProductNotFoundError(
        f"{config.path.name}: no top-level Part or Assembly has the notebook "
        f"id {config.id!r}; Parts and Assemblies found: {found}"
    )


def project_product(
    product: Product,
    *,
    config: NotebookConfig,
    cells: NotebookCells,
    values: Iterable[object],
) -> Product:
    """Return *product* (cadflow products carry no separate definition).

    Kept for call-site compatibility with the headless runner and the live
    kernel path; both compile the scene package from the returned product.
    """

    return product


__all__ = ["Product", "ProductNotFoundError", "find_product", "project_product"]
