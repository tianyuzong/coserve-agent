"""Assembly constraint solving (cadflow-backed)."""

from cadflow._engine.assembly.product import (
    ConstraintReport,
    ConstraintResidual,
    solve_assembly_constraints,
)

__all__ = ["ConstraintReport", "ConstraintResidual", "solve_assembly_constraints"]
