"""Product model (Part / Assembly / Material / Placement / connectors).

Backed by cadflow's consolidated product model
(``cadflow._engine.assembly.product``).  ``product.packages`` turns a product
into a cadflow-1.0 scene package.
"""

from cadflow._engine.assembly import product as _product

Part = _product.Part
Assembly = _product.Assembly
Component = _product.Component
Material = _product.Material
Placement = _product.Placement
GeometryRef = _product.GeometryRef
ConnectorAnchor = _product.ConnectorAnchor
Connector = _product.Connector
ConnectorRef = _product.ConnectorRef
ScalarLimit = _product.ScalarLimit
Constraint = _product.Constraint
ConstraintReport = _product.ConstraintReport
ConstraintResidual = _product.ConstraintResidual
solve_assembly_constraints = _product.solve_assembly_constraints
coupling_phase_offset = _product.coupling_phase_offset

__all__ = [
    "Assembly",
    "Component",
    "Connector",
    "ConnectorAnchor",
    "ConnectorRef",
    "Constraint",
    "ConstraintReport",
    "ConstraintResidual",
    "GeometryRef",
    "Material",
    "Part",
    "Placement",
    "ScalarLimit",
    "coupling_phase_offset",
    "solve_assembly_constraints",
]
