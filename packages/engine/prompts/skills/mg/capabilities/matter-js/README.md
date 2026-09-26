# Rigid-body physics (matter-js)

2D rigid bodies, collisions, falling and stacking. Precompute the motion trajectories, then read the pose by time; draw with DOM, SVG or canvas.

When you need it, read [Simulate and replay rigid bodies](APIs/Matter.md). It contains a component example you can drop into a scene, the parameters, and the library's limits.

Object shapes must match their collision bodies. Landings, bounces and chain collisions come from the simulation data; pick a trajectory that supports the explanation instead of rolling the dice again on every playback.
