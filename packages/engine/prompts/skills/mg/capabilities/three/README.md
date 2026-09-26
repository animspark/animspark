# 3D (three)

Real 3D scenes, lights, materials and cameras. Import `three` directly; import extensions from `three/addons/...`.

When you need it, read [Set up a scene and render it](APIs/useSharedRenderer.md). It contains a component example you can drop into a scene, the parameters, and the library's limits.
For post-processing effects, read [useSharedPaint](APIs/useSharedPaint.md).

Real lighting, perspective and occlusion need 3D geometry. Give the camera, lights and objects distinct roles; if only flat cards are moving, just use the DOM.
