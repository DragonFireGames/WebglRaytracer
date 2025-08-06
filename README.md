# WebGL Path Tracing

WebGL Path Tracing is a realistic lighting demo that simulates light bouncing around a scene in real time using WebGL. The algorithm supports diffuse, mirrored, glossy, and other materials. The rendering is continuous: the image starts grainy and becomes smoother over time.

## Features

- Realtime path tracing in the browser (WebGL)
- Supports diffuse, mirrored, glossy, glass, smooth, bubble, and emissive materials
- Scene is dynamically compiled into GLSL shaders for fast rendering
- Two Cornell Box environments (yellow/blue and red/green)
- Soft shadows via per-pixel light jittering
- Debug views: normals, UVs, depths, mask, and tracer output
- Add and interact with objects: Sphere, Cube, Cone, Cylinder, Torus

## How to Use

- **Add objects:** Use the "Add Sphere" or "Add Cube" buttons
- **Select objects:** Click on an object to select it
- **Move objects:** Drag the selected object along its selection box face
- **Delete objects:** Press Backspace to delete selected object
- **Rotate camera:** Drag the background to rotate the view
- **Change materials:** Select from diffuse, mirror, glossy, etc. and adjust glossiness factor
- **Change environment:** Switch between two Cornell Box presets
- **Debug modes:** View normals, UVs, depths, or mask with dedicated buttons
- **Set bounces:** Adjust the number of light bounces per ray
- **Record:** Use the "Record" button to capture a video

## Technical Details

- The scene is compiled into a GLSL shader; changes to geometry or material trigger recompilation.
- Pixel color is computed by shooting rays and allowing up to five bounces.
- Direct light and shadows are accumulated at each bounce.
- Requires browser support for floating-point textures for full convergence.

## Credits

Made by [DragonFireGames](https://github.com/DragonFireGames) in 2025  
Adapted from [https://madebyevan.com/webgl-path-tracing/](https://madebyevan.com/webgl-path-tracing/)
