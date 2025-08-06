/*
 WebGL Path Tracing 
 License: MIT License (see below)

 Copyright (c) 2010 Evan Wallace
 Modified by DragonFireGames (2025)

 Permission is hereby granted, free of charge, to any person
 obtaining a copy of this software and associated documentation
 files (the "Software"), to deal in the Software without
 restriction, including without limitation the rights to use,
 copy, modify, merge, publish, distribute, sublicense, and/or sell
 copies of the Software, and to permit persons to whom the
 Software is furnished to do so, subject to the following
 conditions:

 The above copyright notice and this permission notice shall be
 included in all copies or substantial portions of the Software.

 THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES
 OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT
 HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
 WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
 OTHER DEALINGS IN THE SOFTWARE.
*/

window.Vector = Wugl.Vector;
window.Matrix = Wugl.Matrix;
window.Transform = Wugl.Transform3D;
window.makeLookAt = Wugl.makeLookAt;
window.makePerspective = Wugl.makePerspective;

////////////////////////////////////////////////////////////////////////////////
// shader strings
////////////////////////////////////////////////////////////////////////////////

// vertex shader for drawing a textured quad
const renderVertexSource =`
attribute vec3 vertex;
varying vec2 texCoord;
void main() {
  texCoord = vertex.xy * 0.5 + 0.5;
  gl_Position = vec4(vertex, 1.0);
}
`;

// fragment shader for drawing a textured quad
const renderFragmentSource = `
precision highp float;
varying vec2 texCoord;
uniform sampler2D tex;
vec4 samp(vec2 uv) {
  vec4 color = vec4(0.);
  for (float x = -1.; x <= 1.; x+=1.) {
    for (float y = -1.; y <= 1.; y+=1.) {
      color += texture2D(tex, uv+vec2(x,y)/512.);
    }
  }
  return color / 9.;
}
void main() {
  /*
  float SHARPEN_FACTOR = 1.;
  vec4 edges = vec4(0.);
  edges += samp(texCoord+vec2(1.,0)/512.);
  edges += samp(texCoord+vec2(-1.,0)/512.);
  edges += samp(texCoord+vec2(0,1.)/512.);
  edges += samp(texCoord+vec2(0,-1.)/512.);
  vec4 center = samp(texCoord);
  gl_FragColor = (1.0 + 4.0 * SHARPEN_FACTOR) * center -SHARPEN_FACTOR * edges;
  /*/
  gl_FragColor = pow(texture2D(tex,texCoord),vec4(2.2,2.2,2.2,1.));
  //gl_FragColor = pow(texture2D(tex,texCoord),vec4(0.45,0.45,0.45,1.));
  gl_FragColor = texture2D(tex,texCoord);
  //*/
}
`;

const renderFragmentSource2 = `
precision highp float;
varying vec2 texCoord;
uniform sampler2D tex;
void main() {
  vec4 color = vec4(0.);
  color += texture2D(tex, texCoord);
  gl_FragColor = color;
}
`;

// vertex shader for drawing a line
const lineVertexSource = `
attribute vec3 vertex;
uniform vec3 cubeMin;
uniform vec3 cubeMax;
uniform mat4 modelviewProjection;
void main() {
  gl_Position = modelviewProjection * vec4(mix(cubeMin, cubeMax, vertex), 1.0);
}
`;

// fragment shader for drawing a line
const lineFragmentSource = `
precision highp float;
void main() {
  gl_FragColor = vec4(1.0);
}
`;

// constants for the shaders
//var bounces = '12';
var bounces = '6';
var epsilon = '1e-6';
var infinity = '1e7';
var lightSize = 0.1;
var lightVal = 0.5;

// vertex shader, interpolate ray per-pixel
var tracerVertexSource = `
attribute vec3 vertex;
uniform vec3 eye, ray00, ray01, ray10, ray11;
varying vec3 initialRay;
void main() {
  vec2 percent = vertex.xy * 0.5 + 0.5;
  initialRay = mix(mix(ray00, ray01, percent.y), mix(ray10, ray11, percent.y), percent.x);
  gl_Position = vec4(vertex, 1.0);
}
`;

// start of fragment shader
var tracerFragmentSourceHeader = `
#define EPSILON  ${epsilon}
#define INFINITY  ${infinity}
#define PI     3.141592653589793
#define TWO_PI 6.283185307179586

precision highp float;
precision lowp sampler3D;

uniform vec3 eye;
varying vec3 initialRay;
uniform float textureWeight;
uniform float timeSinceStart;
uniform sampler2D tex;
vec3 roomCubeMin = vec3(-1.0, -1.0, -1.0);
vec3 roomCubeMax = vec3(1.0, 1.0, 1.0);
`;

var libraryFunctionsSource = `

float intersectGround(vec3 origin, vec3 ray, float height) {
  float t = (height - origin.y) / ray.y;
  return t;
}

// compute the near and far intersections of the cube (stored in the x and y components) using the slab method
// no intersection means vec.x > vec.y (really tNear > tFar)
vec2 intersectCube(vec3 origin, vec3 ray, vec3 cubeMin, vec3 cubeMax) {
  vec3 tMin = (cubeMin - origin) / ray;
  vec3 tMax = (cubeMax - origin) / ray;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar = min(min(t2.x, t2.y), t2.z);
  return vec2(tNear, tFar);
}


void normalForCube1(inout vec3 normal, inout vec2 uv, vec3 hit, vec3 cubeMin, vec3 cubeMax) {
  if (hit.x < cubeMin.x + EPSILON) {
    normal = vec3(-1.0, 0.0, 0.0);
    uv = hit.yz;
    uv = vec2(uv.x,1.-uv.y);
  } else if (hit.x > cubeMax.x - EPSILON) {
    normal = vec3(1.0, 0.0, 0.0);
    uv = vec2(1.) - hit.yz;
  } else if (hit.y < cubeMin.y + EPSILON) {
    normal = vec3(0.0, -1.0, 0.0);
    uv = vec2(1.) - hit.xz;
  } else if (hit.y > cubeMax.y - EPSILON) {
    normal = vec3(0.0, 1.0, 0.0);
    uv = hit.xz;
    uv = vec2(uv.x,1.-uv.y);
  } else if (hit.z < cubeMin.z + EPSILON) {
    normal = vec3(0.0, 0.0, -1.0);
    uv = hit.xy;
    uv = vec2(uv.x,1.-uv.y);
  } else { 
    normal = vec3(0.0, 0.0, 1.0);
    uv = hit.xy;
  }
}

void intersectCube(vec3 origin, vec3 ray, inout float t, inout vec3 normal, inout vec2 uv, vec3 cubeMin, vec3 cubeMax) {
  vec3 tMin = (cubeMin - origin) / ray;
  vec3 tMax = (cubeMax - origin) / ray;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar = min(min(t2.x, t2.y), t2.z);
  if (tNear > tFar) return;
  if (tNear > 0.0 && tNear < t) {
    t = tNear;
    normalForCube1(normal,uv,origin+ray*t,cubeMin,cubeMax);
  }
}

void intersectCube(vec3 origin, vec3 ray, inout float t, inout vec3 normal, inout vec2 uv, inout bool inside, vec3 cubeMin, vec3 cubeMax) {
  vec3 tMin = (cubeMin - origin) / ray;
  vec3 tMax = (cubeMax - origin) / ray;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar = min(min(t2.x, t2.y), t2.z);
  if (tNear > tFar) return;
  if(tNear > 0.0 && tNear < t) {
    t = tNear;
    inside = false;
    normalForCube1(normal,uv,origin+ray*t,cubeMin,cubeMax);
  } else if (tFar > 0.0 && tFar < t) {
    t = tFar;
    inside = true;
    normalForCube1(normal,uv,origin+ray*t,cubeMin,cubeMax);
  }
}

// given that hit is a point on the sphere, what is the surface normal?
void normalForSphere(inout vec3 normal, inout vec2 uv, vec3 hit, vec3 sphereCenter, float sphereRadius) {
  normal = (hit - sphereCenter) / sphereRadius;
  uv = vec2(0.5 + atan(normal.z, normal.x) / TWO_PI, asin(normal.y) / PI - 0.5);
}

void intersectSphere(vec3 origin, vec3 ray, inout float t, inout vec3 normal, inout vec2 uv, vec3 sphereCenter, float sphereRadius) {
  vec3 toSphere = origin - sphereCenter;
  float b = dot(toSphere, ray);
  float c = dot(toSphere, toSphere) - sphereRadius*sphereRadius;
  float h = b*b - c;
  if (h < 0.0) return;
  float t1 = -b - sqrt(h);
  if (t1 > 0.0 && t1 < t) {
    t = t1;
    normalForSphere(normal, uv, origin+t*ray, sphereCenter, sphereRadius);
    return;
  }
}

void intersectSphere(vec3 origin, vec3 ray, inout float t, inout vec3 normal, inout vec2 uv, inout bool inside, vec3 sphereCenter, float sphereRadius) {
  vec3 toSphere = origin - sphereCenter;
  float b = dot(toSphere, ray);
  float c = dot(toSphere, toSphere) - sphereRadius*sphereRadius;
  float h = b*b - c;
  if (h < 0.0) return;
  h = sqrt(h);
  float t1 = -b - h;
  if (t1 > 0.0 && t1 < t) {
    t = t1;
    normalForSphere(normal, uv, origin+t*ray, sphereCenter, sphereRadius);
    return;
  }
  float t2 = -b + h;
  if (t2 > 0.0 && t2 < t) {
    t = t2;
    inside = true;
    normalForSphere(normal, uv, origin+t*ray, sphereCenter, sphereRadius);
    return;
  }
}

void normalForCube1(inout vec3 normal, inout vec2 uv, vec3 hit) {
  vec3 hit2 = (hit-1.)/2.;
  if (hit.x < -1. + EPSILON) {
    normal = vec3(-1.0, 0.0, 0.0);
    uv = hit2.yz;
    uv = vec2(uv.x,1.-uv.y);
  } else if (hit.x > 1. - EPSILON) {
    normal = vec3(1.0, 0.0, 0.0);
    uv = vec2(1.) - hit2.yz;
  } else if (hit.y < -1. + EPSILON) {
    normal = vec3(0.0, -1.0, 0.0);
    uv = vec2(1.) - hit2.xz;
  } else if (hit.y > 1. - EPSILON) {
    normal = vec3(0.0, 1.0, 0.0);
    uv = hit2.xz;
    uv = vec2(uv.x,1.-uv.y);
  } else if (hit.z < -1. + EPSILON) {
    normal = vec3(0.0, 0.0, -1.0);
    uv = hit2.xy;
    uv = vec2(uv.x,1.-uv.y);
  } else { 
    normal = vec3(0.0, 0.0, 1.0);
    uv = hit2.xy;
  }
}

float intersectCube(vec3 origin, vec3 ray, inout bool inside) {
  vec3 tMin = (vec3(-1.) - origin) / ray;
  vec3 tMax = (vec3(1.) - origin) / ray;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar = min(min(t2.x, t2.y), t2.z);
  if (tNear > tFar) return -1.;
  if(tNear > 0.0) {
    inside = false;
    return tNear;
  } else if (tFar > 0.0) {
    inside = true;
    return tFar;
  }
  return -1.;
}

float intersectVolume(vec3 origin, vec3 ray, vec3 cubeMin, vec3 cubeMax) {
  vec3 tMin = (cubeMin - origin) / ray;
  vec3 tMax = (cubeMax - origin) / ray;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar = min(min(t2.x, t2.y), t2.z);
  if (tNear > tFar) return -1.;
  if(tNear > 0.0) {
    return tNear;
  } else if (tFar > 0.0) {
    return 0.0;
  }
  return -1.;
}

vec2 intersectVolume2(vec3 origin, vec3 ray, vec3 cubeMin, vec3 cubeMax) {
  vec3 tMin = (cubeMin - origin) / ray;
  vec3 tMax = (cubeMax - origin) / ray;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar = min(min(t2.x, t2.y), t2.z);
  return vec2(max(tNear,0.), max(tFar,0.));
}

float phaseHG(vec3 ray, vec3 ldir, float g) {
  float cos_theta = dot(ray,ldir);
  float denom = 1. + g * g - 2. * g * cos_theta;
  return 1. / (4. * PI) * (1. - g * g) / (denom * sqrt(denom));
  //return 1. / (1. - g * g) / (denom * sqrt(denom));
}

bool intersectBox(vec3 origin, vec3 invray, vec3 cubeMin, vec3 cubeMax) {
  vec3 tMin = (cubeMin - origin) * invray;
  vec3 tMax = (cubeMax - origin) * invray;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar = min(min(t2.x, t2.y), t2.z);
  if (tNear < 0. && tFar < 0.) return false;
  return tNear <= tFar;
}

bool intersectBox(vec3 origin, vec3 invray, vec3 cubeMin, vec3 cubeMax, float t) {
  vec3 tMin = (cubeMin - origin) * invray;
  vec3 tMax = (cubeMax - origin) * invray;
  vec3 t1 = min(tMin, tMax);
  vec3 t2 = max(tMin, tMax);
  float tNear = max(max(t1.x, t1.y), t1.z);
  float tFar = min(min(t2.x, t2.y), t2.z);
  //if (tNear < 0. && tFar < 0.) return false;
  //if (tNear > t) return false;
  //return tNear <= tFar;
  return !(tNear < 0. && tFar < 0.) && tNear <= min(tFar, t);
}

bool checkSplit(vec3 origin, vec3 split) {
  /*
  int axis = int(split.x+0.5);
  if (axis == 0) return origin.x < split.y;
  if (axis == 1) return origin.y < split.y;
  if (axis == 2) return origin.z < split.y;
  return false;
  */
  // Create mask from split.x (axis)
  vec3 mask = step(split.xxx, vec3(0.5, 1.5, 2.5)) * step(vec3(2.-split.x), vec3(2.5, 1.5, 0.5));
  // Compare using masked selection
  return dot(origin * mask, vec3(1.0)) < split.y;
  //*
}

// given that hit is a point on the cube, what is the surface normal?
// TODO: do this with fewer branches
void normalForCube0(inout vec3 normal, inout vec2 uv, vec3 hit, vec3 cubeMin, vec3 cubeMax) {
  vec3 size = cubeMax - cubeMin; vec3 min = cubeMin;
  //vec3 size = vec3(1); vec3 min = vec3(0);
  if (hit.x < cubeMin.x + EPSILON) {
    normal = vec3(-1.0, 0.0, 0.0);
    uv = (hit.yz - min.yz) / size.yz;
    uv = vec2(uv.x,1.-uv.y);
  } else if (hit.x > cubeMax.x - EPSILON) {
    normal = vec3(1.0, 0.0, 0.0);
    uv = vec2(1.) - (hit.yz - min.yz) / size.yz;
  } else if (hit.y < cubeMin.y + EPSILON) {
    normal = vec3(0.0, -1.0, 0.0);
    uv = vec2(1.) - (hit.xz - min.xz) / size.xz;
  } else if (hit.y > cubeMax.y - EPSILON) {
    normal = vec3(0.0, 1.0, 0.0);
    uv = (hit.xz - min.xz) / size.xz;
    uv = vec2(uv.x,1.-uv.y);
  } else if (hit.z < cubeMin.z + EPSILON) {
    normal = vec3(0.0, 0.0, -1.0);
    uv = (hit.xy - min.xy) / size.xy;
    uv = vec2(uv.x,1.-uv.y);
  } else { 
    normal = vec3(0.0, 0.0, 1.0);
    uv = (hit.xy - min.xy) / size.xy;
  }
}

// compute the near intersection of a sphere
// no intersection returns a value of +infinity

float intersectSphere(vec3 origin, vec3 ray, vec3 sphereCenter, float sphereRadius, inout bool inside) {
  vec3 toSphere = origin - sphereCenter;
  float a = dot(ray, ray);
  float b = 2.0 * dot(toSphere, ray);
  float c = dot(toSphere, toSphere) - sphereRadius*sphereRadius;
  float discriminant = b*b - 4.0*a*c;
  if(discriminant > 0.0) {
    float t1 = (-b - sqrt(discriminant)) / (2.0 * a);
    float t2 = (-b + sqrt(discriminant)) / (2.0 * a);
    float t = t1 > 0.0 ? min(t1,t2) : t2;
    if (t > 0.0) {
      if (t2 == t) inside = true;
      return t;
    }
  }
  return INFINITY;
}

float intersectSphere(vec3 ro, vec3 rd, inout bool inside) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - 1.;
  float h = b*b-c;
  if (h < 0.0) return -1.0;
  h = sqrt(h);
  float t1 = -b-h;
  float t2 = -b+h;
  float t = t1 > 0.0 ? min(t1,t2) : t2;
  if (t > 0.0) {
    if (t2 == t) inside = true;
    return t;
  }
  return -1.0;
}

/*float intersectCylinder(vec3 origin, vec3 ray, vec3 cylinderCenter, float cylinderRadius, float cylinderHeight, inout bool inside) {
  vec2 toCenter = origin.xz - cylinderCenter.xz;
  float a = dot(ray.xz, ray.xz);
  float b = 2.0 * dot(toCenter, ray.xz);
  float c = dot(toCenter, toCenter) - cylinderRadius*cylinderRadius;
  float discriminant = b*b - 4.0*a*c;
  float ymax = cylinderCenter.y+0.5*cylinderHeight;
  float ymin = cylinderCenter.y-0.5*cylinderHeight;
  if (discriminant > 0.0) {
    float t1 = (-b - sqrt(discriminant)) / (2.0 * a);
    float t2 = (-b + sqrt(discriminant)) / (2.0 * a);
    float t = t1 > 0.0 ? min(t1,t2) : t2;
    if (t > 0.0) {
      if (t2 == t) inside = true;
      // if ((origin+ray*t).y > ymax) {
      //   float ty = (ymax - origin.y) / ray.y;
      //   vec2 h1 = (origin+ray*ty).xz - cylinderCenter.xz;
      //   if (ty < 0. || h1.x*h1.x + h1.y*h1.y > cylinderRadius*cylinderRadius) return INFINITY;
      //   return ty;
      // }
      // if ((origin+ray*t).y < ymin) {
      //   float ty = (ymin - origin.y) / ray.y;
      //   vec2 h1 = (origin+ray*ty).xz - cylinderCenter.xz;
      //   if (ty < 0. || h1.x*h1.x + h1.y*h1.y > cylinderRadius*cylinderRadius) return INFINITY;
      //   return ty;
      // }
      return t;
    }
  }
  return INFINITY;
}*/

// same as above, but specialized to the Y axis
float intersectCylinder(vec3 ro, vec3 rd, vec3 cc, float ra, float he, inout vec3 normal, inout bool inside) {
  ro = ro-cc;
  
  float k2 = 1.0 - rd.y*rd.y;
  float k1 = dot(ro,rd) - ro.y*rd.y;
  float k0 = dot(ro,ro) - ro.y*ro.y - ra*ra;
    
  float h = k1*k1 - k2*k0;
  if(h < 0.0) return -1.;
  h = sqrt(h);
  float t = (-k1-h)/k2;

  // body
  float y = ro.y + t*rd.y;
  if (y > -he && y < he && t > 0.) {
    normal = (ro + t*rd - vec3(0.0,y,0.0)) / ra;
    return t;
  }
    
  // caps
  t = (((y<0.0)?-he:he) - ro.y)/rd.y;
  if(abs(k1+k2*t)<h && t > 0.) {
    normal = vec3(0.0, sign(y), 0.0);
    return t;
  }

  float t2 = (-k1+h)/k2;
  float y2 = ro.y + t2*rd.y;
  if (y2 > -he && y2 < he) {
    normal = (ro + t2*rd - vec3(0.0,y2,0.0)) / ra;
    inside = true;
    return t2;
  }
  
  t2 = (((y2<0.0)?-he:he) - ro.y)/rd.y;
  if(abs(k1+k2*t2)<h) {
    normal = vec3(0.0, sign(y2), 0.0);
    inside = true;
    return t2;
  }

  return -1.;
}

float intersectCylinder(vec3 ro, vec3 rd, inout bool inside) {
  float k2 = 1.0 - rd.y*rd.y;
  float k1 = dot(ro,rd) - ro.y*rd.y;
  float k0 = dot(ro,ro) - ro.y*ro.y - 1.0;
    
  float h = k1*k1 - k2*k0;
  if (h < 0.0) return -1.;
  h = sqrt(h);
  float t = (-k1-h)/k2;

  // body
  float y = ro.y + t*rd.y;
  if (y > -1. && y < 1. && t > 0.) {
    return t;
  }
    
  // caps
  t = (((y < 0.0) ? -1. : 1.) - ro.y)/rd.y;
  if(abs(k1+k2*t) < h && t > 0.) {
    return t;
  }

  float t2 = (-k1+h)/k2;
  float y2 = ro.y + t2*rd.y;
  if (y2 > -1. && y2 < 1.) {
    inside = true;
    return t2;
  }
  
  t2 = (((y2 < 0.0) ? -1. : 1.) - ro.y)/rd.y;
  if(abs(k1+k2*t2) < h) {
    inside = true;
    return t2;
  }

  return -1.;
}

void normalForCylinder(inout vec3 normal, inout vec2 uv, vec3 hit) {
  if (hit.y > 1. - EPSILON) {
    normal = vec3(0.0, 1.0, 0.0);
    uv = hit.xz;
    uv = vec2(uv.x,1.-uv.y);
  } else if (hit.y < -1. + EPSILON) {
    normal = vec3(0.0, -1.0, 0.0);
    uv = vec2(1.) - hit.xz;
  } else {
    normal = vec3(hit.x,0,hit.z);
    uv = vec2(0.5 + atan(normal.z, normal.x) / TWO_PI, hit.y + 0.5 );
  }
}
float dot2( vec3 v ) { return dot(v,v); }

float intersectCone(vec3 ro, vec3 rd, float top, inout vec3 normal, inout vec2 uv, inout bool inside) {
  float he = 1.;
  float ra = 1.;
  float rb = top;

  vec3  ob = ro - vec3(0.0,he,0.0);
  
  //caps
  if (ro.y < 0.0 && -ro.y/rd.y > 0.) {
    if (dot2(ro*rd.y-rd*ro.y) < (ra*ra*rd.y*rd.y)) {
      normal = vec3(0.0,-1.0,0.0);
      return -ro.y/rd.y; 
    }
  } else if (ro.y > he && -ob.y/rd.y > 0.) {
    if (dot2(ob*rd.y-rd*ob.y) < (rb*rb*rd.y*rd.y)) {
      normal = vec3(0.0,1.0,0.0);
      return -ob.y/rd.y; 
    }
  }
  
  // body
  float m4 = dot(rd,ro);
  float m5 = dot(ro,ro);
  float rr = ra - rb;
  float hy = he*he + rr*rr;

  float k2 = he*he    - rd.y*rd.y*hy;
  float k1 = he*he*m4 - ro.y*rd.y*hy + ra*(rr*he*rd.y*1.0 );
  float k0 = he*he*m5 - ro.y*ro.y*hy + ra*(rr*he*ro.y*2.0 - he*he*ra);

  float h = k1*k1 - k2*k0;
  if (h < 0.0) return -1.;
  h = sqrt(h);
  
  float t = (-k1-h)/k2;

  float y = ro.y + t*rd.y;
  if(y > 0.0 && y < he && t > 0.) {
    normal = normalize(he*he*(ro+t*rd) + vec3(0.0,rr*he*ra - hy*y,0.0));
    return t;
  }

  float t2 = (-k1+h)/k2;

  float y2 = ro.y + t2*rd.y;
  if(y2 > 0.0 && y2 < he) {
    normal = normalize(he*he*(ro+t2*rd) + vec3(0.0,rr*he*ra - hy*y2,0.0));
    inside = true;
    return t2;
  }

  //caps
  if(ro.y > 0.0 ) {
    if(dot2(ro*rd.y-rd*ro.y) < (ra*ra*rd.y*rd.y)) {
      normal = vec3(0.0,-1.0,0.0);
      return -ro.y/rd.y; 
    }
  } else if (ro.y < he) {
    if(dot2(ob*rd.y-rd*ob.y) < (rb*rb*rd.y*rd.y)) {
      normal = vec3(0.0,1.0,0.0);
      return -ob.y/rd.y; 
    }
  }

  return -1.;
}

float intersectTorus(vec3 ro, vec3 rd, vec2 tor, inout bool inside) {
  
    float po = 1.0;
    
    float Ra2 = tor.x*tor.x;
    float ra2 = tor.y*tor.y;
	
    float m = dot(ro,ro);
    float n = dot(ro,rd);

    // bounding sphere
    {
	float h = n*n - m + (tor.x+tor.y)*(tor.x+tor.y);
	if( h<0.0 ) return -1.0;
	//float t = -n-sqrt(h); // could use this to compute intersections from ro+t*rd
    }
    
	// find quartic equation
    float k = (m - ra2 - Ra2)/2.0;
    float k3 = n;
    float k2 = n*n + Ra2*rd.z*rd.z + k;
    float k1 = k*n + Ra2*ro.z*rd.z;
    float k0 = k*k + Ra2*ro.z*ro.z - Ra2*ra2;
	
    #if 1
    // prevent |c1| from being too close to zero
    if( abs(k3*(k3*k3 - k2) + k1) < 0.01 )
    {
        po = -1.0;
        float tmp=k1; k1=k3; k3=tmp;
        k0 = 1.0/k0;
        k1 = k1*k0;
        k2 = k2*k0;
        k3 = k3*k0;
    }
	#endif

    float c2 = 2.0*k2 - 3.0*k3*k3;
    float c1 = k3*(k3*k3 - k2) + k1;
    float c0 = k3*(k3*(-3.0*k3*k3 + 4.0*k2) - 8.0*k1) + 4.0*k0;

    
    c2 /= 3.0;
    c1 *= 2.0;
    c0 /= 3.0;
    
    float Q = c2*c2 + c0;
    float R = 3.0*c0*c2 - c2*c2*c2 - c1*c1;
    
	
    float h = R*R - Q*Q*Q;
    float z = 0.0;
    if( h < 0.0 )
    {
    	// 4 intersections
        float sQ = sqrt(Q);
        z = 2.0*sQ*cos( acos(R/(sQ*Q)) / 3.0 );
    }
    else
    {
        // 2 intersections
        float sQ = pow( sqrt(h) + abs(R), 1.0/3.0 );
        z = sign(R)*abs( sQ + Q/sQ );
    }		
    z = c2 - z;
	
    float d1 = z   - 3.0*c2;
    float d2 = z*z - 3.0*c0;
    if( abs(d1) < 1.0e-4 )
    {
        if( d2 < 0.0 ) return -1.0;
        d2 = sqrt(d2);
    }
    else
    {
        if( d1 < 0.0 ) return -1.0;
        d1 = sqrt( d1/2.0 );
        d2 = c1/d1;
    }

    //----------------------------------
	
    float result = INFINITY;

    h = d1*d1 - z + d2;
    if( h > 0.0 )
    {
        h = sqrt(h);
        float t1 = -d1 - h - k3; t1 = (po<0.0)?2.0/t1:t1;
        float t2 = -d1 + h - k3; t2 = (po<0.0)?2.0/t2:t2;
        if( t1 > 0.0 ) result=t1; 
        if( t2 > 0.0 ) result=min(result,t2);
    }

    h = d1*d1 - z - d2;
    if( h > 0.0 )
    {
        h = sqrt(h);
        float t1 = d1 - h - k3;  t1 = (po<0.0)?2.0/t1:t1;
        float t2 = d1 + h - k3;  t2 = (po<0.0)?2.0/t2:t2;
        if( t1 > 0.0 ) result=min(result,t1);
        if( t2 > 0.0 ) result=min(result,t2);
    }
    
    return result;
}

void normalForTorus(inout vec3 normal, inout vec2 uv, vec3 hit, vec2 tor) {
  normal = normalize(hit*(dot(hit,hit)-tor.y*tor.y-tor.x*tor.x*vec3(1.0,1.0,-1.0)));
  uv = vec2(0.8*atan(hit.x,hit.y),atan(hit.z,length(hit.xy)-tor.y));
}

void rayDistPoint(vec3 origin, vec3 ray, vec3 center, inout float dL, inout float dT) {
  vec3 toSphere = origin - center;
  float a = dot(ray, ray);
  float b = dot(toSphere, ray);
  float c = dot(toSphere, toSphere);
  dL = c - b*b / a;
  dT = -b / a;
}

void intersectTriangle(vec3 origin, vec3 ray, inout float t, inout vec2 uv, inout vec3 normal, inout bool inside, vec3 v0, vec3 v1, vec3 v2) { 
  vec3 v0v1 = v1 - v0; 
  vec3 v0v2 = v2 - v0; 
  vec3 pvec = cross(ray,v0v2); 
  float det = dot(v0v1,pvec); 

  // No Culling 
  // If det is close to 0, the ray and triangle are parallel. 
  if (abs(det) < EPSILON) return; 

  float invDet = 1. / det; 
  vec3 tvec = origin - v0; 

  float u = dot(tvec,pvec) * invDet; 
  if (u < 0. || u > 1.) return; 
  vec3 qvec = cross(tvec,v0v1); 

  float v = dot(ray,qvec) * invDet; 
  if (v < 0. || u + v > 1.) return; 
  float t0 = dot(v0v2,qvec) * invDet;

  if (t0 < 0. || t0 > t) return; 
  t = t0; 
  uv = vec2(u,v); 
  normal = normalize(cross(v0v1, v0v2));
  if (det < EPSILON) inside = true;
}

void intersectTriangle(vec3 origin, vec3 ray, inout float t, inout vec2 uv, inout vec3 normal, inout bool inside, vec3 v0, vec3 v1, vec3 v2, vec2 vt0, vec2 vt1, vec2 vt2) { 
  vec3 v0v1 = v1 - v0; 
  vec3 v0v2 = v2 - v0; 
  vec3 pvec = cross(ray,v0v2); 
  float det = dot(v0v1,pvec); 

  // No Culling 
  // If det is close to 0, the ray and triangle are parallel. 
  if (abs(det) < EPSILON) return; 

  float invDet = 1. / det; 
  vec3 tvec = origin - v0; 

  float u = dot(tvec,pvec) * invDet; 
  if (u < 0. || u > 1.) return; 
  vec3 qvec = cross(tvec,v0v1); 

  float v = dot(ray,qvec) * invDet; 
  if (v < 0. || u + v > 1.) return; 
  float t0 = dot(v0v2,qvec) * invDet;

  if (t0 < 0. || t0 > t) return; 
  t = t0; 
  uv = vt0 * (1. - u - v) + vt1 * u + vt2 * v;
  normal = normalize(cross(v0v1, v0v2));
  inside = det < EPSILON;
}

void intersectTriangle(vec3 origin, vec3 ray, inout float t, inout vec2 uv, inout vec3 normal, vec3 v0, vec3 v1, vec3 v2) { 
  vec3 v0v1 = v1 - v0; 
  vec3 v0v2 = v2 - v0; 
  vec3 pvec = cross(ray,v0v2); 
  float det = dot(v0v1,pvec); 

  // If the determinant is negative, the triangle is back-facing. 
  // If the determinant is close to 0, the ray misses the triangle. 
  if (det < EPSILON) return; 
  
  float invDet = 1. / det; 
  vec3 tvec = origin - v0; 

  float u = dot(tvec,pvec) * invDet; 
  if (u < 0. || u > 1.) return; 
  vec3 qvec = cross(tvec,v0v1); 

  float v = dot(ray,qvec) * invDet; 
  if (v < 0. || u + v > 1.) return; 
  float t0 = dot(v0v2,qvec) * invDet;

  if (t0 < 0. || t0 > t) return; 
  t = t0; 
  uv = vec2(u,v); 
  normal = normalize(cross(v0v1, v0v2));
}

void intersectTriangle(vec3 origin, vec3 ray, inout float t, inout vec2 uv, inout vec3 normal, vec3 v0, vec3 v1, vec3 v2, vec2 vt0, vec2 vt1, vec2 vt2) { 
  vec3 v0v1 = v1 - v0; 
  vec3 v0v2 = v2 - v0; 
  vec3 pvec = cross(ray,v0v2); 
  float det = dot(v0v1,pvec); 

  // If the determinant is negative, the triangle is back-facing. 
  // If the determinant is close to 0, the ray misses the triangle. 
  if (det < EPSILON) return;
  
  float invDet = 1. / det; 
  vec3 tvec = origin - v0; 

  float u = dot(tvec,pvec) * invDet; 
  if (u < 0. || u > 1.) return; 
  vec3 qvec = cross(tvec,v0v1); 

  float v = dot(ray,qvec) * invDet; 
  if (v < 0. || u + v > 1.) return; 
  float t0 = dot(v0v2,qvec) * invDet;

  if (t0 < 0. || t0 > t) return; 
  t = t0; 
  uv = vt0 * (1. - u - v) + vt1 * u + vt2 * v;
  normal = normalize(cross(v0v1, v0v2));
}

void intersectTriangle(vec3 origin, vec3 ray, inout float t, inout vec2 uv, inout vec3 normal, vec3 v0, vec3 v1, vec3 v2, vec2 vt0, vec2 vt1, vec2 vt2, vec3 vn0, vec3 vn1, vec3 vn2) { 
  vec3 v0v1 = v1 - v0; 
  vec3 v0v2 = v2 - v0; 
  vec3 pvec = cross(ray,v0v2); 
  float det = dot(v0v1,pvec); 

  // If the determinant is negative, the triangle is back-facing. 
  // If the determinant is close to 0, the ray misses the triangle. 
  if (det < EPSILON) return;
  
  float invDet = 1. / det; 
  vec3 tvec = origin - v0; 

  float u = dot(tvec,pvec) * invDet; 
  if (u < 0. || u > 1.) return; 
  vec3 qvec = cross(tvec,v0v1); 

  float v = dot(ray,qvec) * invDet; 
  if (v < 0. || u + v > 1.) return; 
  float t0 = dot(v0v2,qvec) * invDet;

  if (t0 < 0. || t0 > t) return; 
  t = t0; 
  uv = vt0 * (1. - u - v) + vt1 * u + vt2 * v;
  normal = vn0 * (1. - u - v) + vn1 * u + vn2 * v; 
  normal = normalize(normal);
}


void intersectTriangle(vec3 origin, vec3 ray, inout float t, inout vec2 uv, inout vec3 normal, vec3 v0, vec3 v1, vec3 v2, vec3 vn0, vec3 vn1, vec3 vn2) { 
  vec3 v0v1 = v1 - v0; 
  vec3 v0v2 = v2 - v0; 
  vec3 pvec = cross(ray,v0v2); 
  float det = dot(v0v1,pvec); 

  // If the determinant is negative, the triangle is back-facing. 
  // If the determinant is close to 0, the ray misses the triangle. 
  if (det < EPSILON) return;
  
  float invDet = 1. / det; 
  vec3 tvec = origin - v0; 

  float u = dot(tvec,pvec) * invDet; 
  if (u < 0. || u > 1.) return; 
  vec3 qvec = cross(tvec,v0v1); 

  float v = dot(ray,qvec) * invDet; 
  if (v < 0. || u + v > 1.) return; 
  float t0 = dot(v0v2,qvec) * invDet;

  if (t0 < 0. || t0 > t) return; 
  t = t0; 
  uv = vec2(u,v);
  normal = vn0 * (1. - u - v) + vn1 * u + vn2 * v; 
  normal = normalize(normal);
}


void intersectTriangle(vec3 origin, vec3 ray, inout float t, inout vec2 uv, inout vec3 normal, inout bool inside, vec3 v0, vec3 v1, vec3 v2, vec2 vt0, vec2 vt1, vec2 vt2, vec3 vn0, vec3 vn1, vec3 vn2) { 
  vec3 v0v1 = v1 - v0; 
  vec3 v0v2 = v2 - v0; 
  vec3 pvec = cross(ray,v0v2); 
  float det = dot(v0v1,pvec); 

  // No Culling 
  // If det is close to 0, the ray and triangle are parallel. 
  if (abs(det) < EPSILON) return; 
  
  float invDet = 1. / det; 
  vec3 tvec = origin - v0; 

  float u = dot(tvec,pvec) * invDet; 
  if (u < 0. || u > 1.) return; 
  vec3 qvec = cross(tvec,v0v1); 

  float v = dot(ray,qvec) * invDet; 
  if (v < 0. || u + v > 1.) return; 
  float t0 = dot(v0v2,qvec) * invDet;

  if (t0 < 0. || t0 > t) return; 
  t = t0; 
  uv = vt0 * (1. - u - v) + vt1 * u + vt2 * v;
  normal = vn0 * (1. - u - v) + vn1 * u + vn2 * v; 
  normal = normalize(normal);
  inside = det < EPSILON;
}


void intersectTriangle(vec3 origin, vec3 ray, inout float t, inout vec2 uv, inout vec3 normal, inout bool inside, vec3 v0, vec3 v1, vec3 v2, vec3 vn0, vec3 vn1, vec3 vn2) { 
  vec3 v0v1 = v1 - v0; 
  vec3 v0v2 = v2 - v0; 
  vec3 pvec = cross(ray,v0v2); 
  float det = dot(v0v1,pvec); 

  // No Culling 
  // If det is close to 0, the ray and triangle are parallel. 
  if (abs(det) < EPSILON) return; 
  
  float invDet = 1. / det; 
  vec3 tvec = origin - v0; 

  float u = dot(tvec,pvec) * invDet; 
  if (u < 0. || u > 1.) return; 
  vec3 qvec = cross(tvec,v0v1); 

  float v = dot(ray,qvec) * invDet; 
  if (v < 0. || u + v > 1.) return; 
  float t0 = dot(v0v2,qvec) * invDet;

  if (t0 < 0. || t0 > t) return; 
  t = t0; 
  uv = vec2(u,v);
  normal = vn0 * (1. - u - v) + vn1 * u + vn2 * v; 
  normal = normalize(normal);
  inside = det < EPSILON;
}

void normalForSphere(inout vec3 normal, inout vec2 uv, vec3 hit) {
  normal = hit;
  uv = vec2(0.5 + atan(normal.z, normal.x) / TWO_PI, asin(normal.y) / PI - 0.5);
}

void normalForCylinder(inout vec3 normal, inout vec2 uv, vec3 hit, vec3 cylinderCenter, float cylinderRadius, float cylinderHeight) {
  if (hit.y > cylinderCenter.y+cylinderHeight - EPSILON) {
    //normal = vec3(0.0, 1.0, 0.0);
    uv = hit.xz;
    uv = vec2(uv.x,1.-uv.y);
  } else if (hit.y < cylinderCenter.y-cylinderHeight + EPSILON) {
    //normal = vec3(0.0, -1.0, 0.0);
    uv = vec2(1.) - hit.xz;
  } else {
    //vec2 normal1 = (hit.xz - cylinderCenter.xz) / cylinderRadius;
    //normal = vec3(normal1.x,0,normal1.y);
    uv = vec2(0.5 + atan(normal.z, normal.x) / TWO_PI, (hit.y - cylinderCenter.y) / cylinderHeight + 0.5 );
  }
}

// use the fragment position for randomness
float random(vec3 scale, float seed) {
  return fract(sin(dot(gl_FragCoord.xyz + seed, scale)) * 43758.5453 + seed);
}
float random2(vec2 p, float seed){
  return fract(cos(dot(p+seed,vec2(23.14069263277926,2.665144142690225)))*12345.6789);
}

// random cosine-weighted distributed vector
// from https://www.rorydriscoll.com/2009/01/07/better-sampling/
vec3 cosineWeightedDirection(float seed, vec3 normal) {
  float u = random(vec3(12.9898, 78.233, 151.7182), seed);
  float v = random(vec3(63.7264, 10.873, 623.6736), seed);
  float r = sqrt(u);
  float angle = TWO_PI * v;
  // compute basis from normal
  vec3 sdir, tdir;
  if (abs(normal.x)<.5) {
    sdir = cross(normal, vec3(1,0,0));
  } else {
    sdir = cross(normal, vec3(0,1,0));
  }
  tdir = cross(normal, sdir);
  return r*cos(angle)*sdir + r*sin(angle)*tdir + sqrt(1.-u)*normal;
}

// random normalized vector
vec3 uniformlyRandomDirection(float seed) {
  float u = random(vec3(12.9898, 78.233, 151.7182), seed);
  float v = random(vec3(63.7264, 10.873, 623.6736), seed);
  float z = 1.0 - 2.0 * u;
  float r = sqrt(1.0 - z * z);
  float angle = TWO_PI * v;
  return vec3(r * cos(angle), r * sin(angle), z);
}

// random vector in the unit sphere
// note: this is probably not statistically uniform, saw raising to 1/3 power somewhere but that looks wrong?
vec3 uniformlyRandomVector(float seed) {
  return uniformlyRandomDirection(seed) * sqrt(random(vec3(36.7539, 50.3658, 306.2759), seed));
}

// Refract Vector
vec3 refraction(vec3 I, vec3 N, float ior, float ior2) {
  float cosi = clamp(-1., 1., dot(I, N));
  vec3 n = N;
  float etai = ior2;
  float etat = ior;
  if (cosi < 0.) {
    cosi = -cosi; 
  } else { 
    etai = ior;
    etat = ior2;
    n = -N;
  }
  float eta = etai / etat;
  float k = 1. - eta * eta * (1. - cosi * cosi);
  return k < 0. ? vec3(0.) : eta * I + (eta * cosi - sqrt(k)) * n;
}

void fresnel(vec3 I, vec3 N, float ior, float ior2, inout float kr) {
    float cosi = clamp(-1., 1., dot(I, N));
    float etai = ior2, etat = ior;
    if (cosi > 0.) { etai = ior, etat = ior2; }
    // Compute sini using Snell's law
    float sint = etai / etat * sqrt(max(0., 1. - cosi * cosi));
    // Total internal reflection
    if (sint >= 1.) {
      kr = 1.;
    } else {
      float cost = sqrt(max(0., 1. - sint * sint));
      cosi = abs(cosi);
      float Rs = ((etat * cosi) - (etai * cost)) / ((etat * cosi) + (etai * cost));
      float Rp = ((etai * cosi) - (etat * cost)) / ((etai * cosi) + (etat * cost));
      kr = (Rs * Rs + Rp * Rp) / 2.;
    }
    // As a consequence of the conservation of energy, the transmittance is given by:
    // kt = 1 - kr;
}

vec3 iridescence(vec3 I, vec3 N, float nu, float filmwidth) {
  mat3 sparsespfiltconst = mat3(vec3(997.744490776777870, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 1000.429230968840700, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 1000.314923254210300));
  mat3 sparsespfilta[13];
  mat3 sparsespfiltb[13];
  sparsespfilta[0] = mat3(vec3(-9.173541963568921, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 0.000000000000000));
	sparsespfilta[1] = mat3(vec3(-12.118820092848431, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.362717643641774, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 0.000000000000000));
	sparsespfilta[2] = mat3(vec3(-18.453733912103289, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 1.063838675818334, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 0.000000000000000));
	sparsespfilta[3] = mat3(vec3(-448.414255038845680, -26.846846493079958, 0.000000000000000), vec3(94.833575999184120, 9.525075729872752, 0.000000000000000), vec3(-48.773853498042200, 0.000000000000000, -0.416692876008104));
	sparsespfilta[4] = mat3(vec3(6.312176276235818, -29.044711065580177, 0.000000000000000), vec3(-187.629408328884550, -359.908263134928520, 0.000000000000000), vec3(0.000000000000000, 25.579031651446712, -0.722360089703890));
	sparsespfilta[5] = mat3(vec3(-33.547962219868452, 61.587972582979901, 0.000000000000000), vec3(97.565538879460178, -150.665614921761320, -30.220477643983013), vec3(1.552347379820659, -0.319166631512109, -0.935186347338915));
	sparsespfilta[6] = mat3(vec3(3.894757056395064, 0.000000000000000, 10.573132007634964), vec3(0.000000000000000, -3.434367603334157, -9.216617325755173), vec3(39.438244799684632, 0.000000000000000, -274.009089525723140));
	sparsespfilta[7] = mat3(vec3(3.824490469437192, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, -1.540065958710146, 35.179624268750139), vec3(0.000000000000000, 0.000000000000000, -239.475015979167920));
	sparsespfilta[8] = mat3(vec3(2.977660826364815, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, -1.042036915995045, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, -2.472524681362817));
	sparsespfilta[9] = mat3(vec3(2.307327051977537, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, -0.875061637866728, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, -1.409849313639845));
	sparsespfilta[10] = mat3(vec3(1.823790655724537, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, -0.781918646414733, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, -1.048825978147449));
	sparsespfilta[11] = mat3(vec3(0.000000000000000, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, -0.868933490490107));
	sparsespfilta[12] = mat3(vec3(0.000000000000000, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, -0.766926116519291));
	sparsespfiltb[0] = mat3(vec3(36.508697968439087, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 0.000000000000000));
	sparsespfiltb[1] = mat3(vec3(57.242341893668829, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 38.326477066948989, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 0.000000000000000));
	sparsespfiltb[2] = mat3(vec3(112.305664332688050, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 59.761768151790150, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 0.000000000000000));
	sparsespfiltb[3] = mat3(vec3(295.791838308625070, 58.489998502973329, 0.000000000000000), vec3(70.091833386311293, 120.512061156381040, 0.000000000000000), vec3(17.204619265336060, 0.000000000000000, 37.784871450121273));
	sparsespfiltb[4] = mat3(vec3(-253.802681237032970, -160.471170139118780, 0.000000000000000), vec3(-194.893137314865900, 220.339388056683760, 0.000000000000000), vec3(0.000000000000000, -22.651202495658183, 57.335351084503102));
	sparsespfiltb[5] = mat3(vec3(-114.597984116320400, 38.688618505605739, 0.000000000000000), vec3(30.320616033665370, -278.354607015268130, 9.944900164751438), vec3(-30.962164636838232, 37.612068254920686, 113.260728861048410));
	sparsespfiltb[6] = mat3(vec3(-78.527368894236332, 0.000000000000000, 30.382451414099631), vec3(0.000000000000000, -116.269817575252430, -55.801473552703627), vec3(0.353768568406928, 0.000000000000000, 243.785483416097240));
	sparsespfiltb[7] = mat3(vec3(-53.536668214025610, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, -68.933243211639621, 17.821880498324404), vec3(0.000000000000000, 0.000000000000000, -278.470203722289060));
	sparsespfiltb[8] = mat3(vec3(-42.646930307293360, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, -51.026918452773138, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, -113.420624636770270));
	sparsespfiltb[9] = mat3(vec3(-35.705990828985080, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, -40.934269625438475, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, -67.307342271105213));
	sparsespfiltb[10] = mat3(vec3(-30.901151041566411, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, -34.440424768095276, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, -49.156471643386766));
	sparsespfiltb[11] = mat3(vec3(0.000000000000000, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, -39.178407337105710));
	sparsespfiltb[12] = mat3(vec3(0.000000000000000, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, 0.000000000000000), vec3(0.000000000000000, 0.000000000000000, -32.812895526130347));
  float cosi = clamp(-1., 1., dot(I, N));
  //iridescence
  const float NN = 2001.0;
  float a = 1.0/(nu*nu);
  float cost = sqrt(a*cosi*cosi + (1.0-a));
  float n = 2.0*PI*filmwidth*cost/NN;
  float kn = 0.0;
  mat3 filt = sparsespfiltconst;
  
  for(int i = 0; i < 13; i++) {
      kn = (float(i)+6.0)*n;
      filt += sparsespfilta[i]*cos(kn) + sparsespfiltb[i]*sin(kn);
  }  
  return clamp(vec3(0.),vec3(1.),2.0*(filt*vec3(1.,1.,1.))/NN);
}

`;

var yellowBlueCornellBox = `
if (hit.x < -1. + EPSILON) surfaceColor = vec3(0.1, 0.5, 1.0); //blue
else if (hit.x > 1. - EPSILON) surfaceColor = vec3(1.0, 0.9, 0.1); //yellow
`;

var redGreenCornellBox = `
if (hit.x < -1. + EPSILON) surfaceColor = vec3(1.0, 0.3, 0.1); // red 
else if (hit.x > 1. - EPSILON) surfaceColor = vec3(0.3, 1.0, 0.1); //green
`;

var gridPlaneColor = `
  surfaceColor = fract(uv.x+0.025) < 0.05 || fract(uv.y+0.025) < 0.05 ? vec3(0.76) : (fract(uv.x*5.+0.025) < 0.05 || fract(uv.y*5.+0.025) < 0.05 ? vec3(0.7) : vec3(0.65));
`;

function makeShadow(scene) {
  return `
   float shadow(vec3 origin, vec3 ray) {
    vec3 colorMask = vec3(1.);
    float t = INFINITY;
    float lray = length(ray);
    float shadowIntensity = 1.0;
  ${concat(scene.objects, function (o) { return o.getShadowTestCode(scene); })}
  ${concat(scene.volumes, function (o) { return o.getShadowTestCodeVol(scene); })}
    return shadowIntensity;
   }
  `;
}

function makeCalculateColor(scene) {
  //*
  if (!scene.debug) return `
vec3 calculateColor(vec3 origin, vec3 ray) {
  ${scene.lights.map(v=>v.getSetLight()).join('')}
  
   vec3 colorMask = vec3(1.0);
   vec3 accumulatedColor = vec3(0.0);
   vec3 extinctionColor = vec3(0.0);
   vec3 emissiveExtinctionColor = vec3(0.0);
   float iorA = 1.;
   bool lightUp1 = false;
   bool lightUp2 = false;

  // main raytracing loop
  int reducebounce = 0;
  for (int bounce = 0; bounce < ${scene.bounces}; bounce++) {
    if (reducebounce+bounce >= ${scene.bounces}) break;
    float lray = length(ray);
    // compute the intersection with everything
    ${scene.background.getIntersectCode(scene)}
    float t = INFINITY;
    ${scene.background.getMinimumIntersectCode()}
    
    ${concat(scene.objects, o => o.getIntersectCode(scene))}
    // find the closest intersection
    ${concat(scene.objects, o => o.getMinimumIntersectCode())}

    // info about hit
     vec3 hit = origin + ray * t;
     vec3 surfaceColor = vec3(0.75);
     vec2 uv;
     vec3 normal;
     vec3 normal2;
     bool inside;

     ${concat(scene.volumes, o => o.getIntersectCodeVol(scene,o.getHitCheckVol(scene)))}
     
     accumulatedColor += colorMask * emissiveExtinctionColor;
     colorMask *= exp(-t*extinctionColor);

    ${scene.background.getAtmosphere(scene)}

    ${scene.lights.map(v=>v.lightUp(scene)).join('')}

    // calculate the normal (and change wall color)
    ${scene.background.getHitCheck(scene)}
    if (t == INFINITY) {
       ${scene.lights.map(v=>v.lightUp2(scene)).join('')}
       ${scene.background.getSkybox()}
       break;
     } else {
       if(false) ; // hack to discard the first 'else' in 'else if'        ${concat(scene.objects, o => o.getHitCheck(scene))}
     }
    
     if (colorMask.x+colorMask.y+colorMask.z < EPSILON) break;
   }
   //accumulatedColor = pow(accumulatedColor,vec3(2.2));
   //return min(vec3(1.),accumulatedColor);
   return accumulatedColor * ${toFloat(scene.camera.exposure)};
   //return normalize(ray);
 }
`;//*/
  return `

vec3 calculateColor(vec3 origin, vec3 ray) {
  int bounce = 0;  
   vec3 colorMask = vec3(1.);
    float lray = length(ray);
    
  // compute the intersection with everything
  ${scene.background.getIntersectCode(scene)}
  float t = INFINITY;
  ${scene.background.getMinimumIntersectCode()}
  ${concat(scene.objects, o => o.getIntersectCode(scene))}
  // find the closest intersection
  ${concat(scene.objects, o => o.getMinimumIntersectCode())}

  // info about hit
   vec3 hit = origin + ray * t;
   vec3 normal;
   vec3 normal2;
   vec2 uv;
   bool inside;

  // calculate the normal (and change wall color)
   ${scene.background.getNormalCalculationCode()} 
   if (t >= INFINITY) {
     return vec3(0.);
   } else {
     if(false) ; // hack to discard the first 'else' in 'else if' ${concat(scene.objects, o => o.getNormalCalculationCode())}
   }
   return ${(function(){
      switch (scene.debug) {
        case "normals": return `normal * colorMask`;
        case "normals2": return `inside ? vec3(1.) : normal`;
        case "uvs": return `vec3(uv.x,uv.y,1.-uv.x*uv.y)`;
        case "depth": return `vec3(t/20.)`;
        case "depth1": return `vec3(1./log(t))`;
      }
      return scene.debug;
    })()};
 }`;
 //*/
}

//var XOX = 14492//3988*3;
// XOX*3+2 = 2^16
function makeMain() {
  //var buf = ui.scene.objects[1]?.model?.buffers?.nodebounds;
  //vec3 samp = sampleTexBuf1(int(gl_FragCoord.x/512.*2.));
    //int samp = ${(buf?.sample(XOX*3)||'-1')};
    //if (samp == ${(buf?.triangles?.data[XOX*3]||'0')}) gl_FragColor = vec4(1);
    //vec3 samp = ${(buf?.sample(XOX)||'vec3(0)')};
    //if (distance(samp,${toVec(3,buf?.data.slice(XOX*3,XOX*3+3)||[1,1,1])}) < 0.01) gl_FragColor = vec4(1);
    //else gl_FragColor = vec4(samp/255.,1);
    //gl_FragColor = vec4(samp,1);
    //gl_FragColor = texture2D(texBuf1,gl_FragCoord.xy/512.0);
  
  return `
  void main() {
    vec3 prev = texture2D(tex, gl_FragCoord.xy / 512.0).rgb;
    gl_FragColor = vec4(mix(calculateColor(eye, initialRay), prev, textureWeight), 1.0);
  }`;
}

function makeTracerFragmentSource(scene) {
  return tracerFragmentSourceHeader +
    concat(scene.textures, o => o.getGlobalCode()) +
    libraryFunctionsSource +
    concat(scene.objects, o => o.getGlobalCode(scene)) +
    makeShadow(scene) +
    makeCalculateColor(scene) +
    makeMain(scene);
}

////////////////////////////////////////////////////////////////////////////////
// utility functions
////////////////////////////////////////////////////////////////////////////////

function concat(objects, func) {
  var text = '';
  for (var i = 0; i < objects.length; i++) {
    text += func(objects[i]);
  }
  return text;
}

Vector.prototype.ensure3 = function () {
  return new Vector([this[0], this[1], this[2]]);
};
Vector.prototype.ensure4 = function (w) {
  return new Vector([this[0], this[1], this[2], w]);
};
Vector.prototype.divideByW = function () {
  return this.divide(this.e(-1));
};
Vector.min = function (v1, v2) {
  return v1._applyOperation(v2,(a,b)=>Math.min(a,b));
};
Vector.max = function (v1, v2) {
  return v1._applyOperation(v2,(a,b)=>Math.max(a,b));
};
Vector.prototype.minComponent = function () {
  var value = Number.MAX_VALUE;
  for (var i = 0; i < this.length; i++) {
    value = Math.min(value, this[i]);
  }
  return value;
};
Vector.prototype.maxComponent = function () {
  var value = -Number.MAX_VALUE;
  for (var i = 0; i < this.length; i++) {
    value = Math.max(value, this[i]);
  }
  return value;
};

////////////////////////////////////////////////////////////////////////////////
// classes
////////////////////////////////////////////////////////////////////////////////

class Texture {
  constructor(url,onload,filter) {
    this.url = url;
    this.id = 0;
    this.filterCode = (tex,uv) => tex(uv);
    //this.texStr = "tex"+this.id;
    var self = this;
    this.width = 1;
    this.height = 1;
    this.texture = loadTexture(gl,this.url,(image)=>{
      this.width = image.width;
      this.height = image.height;
      if (onload) onload(self);
    },filter);
  }
  get texStr() {return 'tex'+this.id;}
  texture2D(uv,scene) {
    return this.filterCode(function(uv) {
      return`texture2D(${this.texStr},${uv})`;
    }.bind(this),uv,scene);
  }
  getGlobalCode() {
    return `
      uniform sampler2D ${this.texStr};`;
  }
}
class ProceduralTexture {
  constructor(code,globalCode) {
    this.id = 0;
    this.code = code||`vec3(0.5,0.5,1)`;
    this.width = 1000;
    this.globalCode = globalCode||``;
  }
  texture2D(uv) {
    return this.code.replaceAll('uv',`(${uv})`);
  }
  getGlobalCode() {
    return this.globalCode;
  }
}

function toFloat(n) {
  if (n % 1 == 0) return n+".";
  return n.toString();
}
function toVec(d,n) {
  if (n instanceof Vector) n = Array.from(n);
  if (typeof n == "number") n = new Array(d).fill(n); 
  if (n.length > d) n = n.slice(0,d);
  return "vec"+d+"("+n.map(toFloat).join(",")+")";
}

var materials = [];

class Material {
  constructor(type, color) {
    this.type = type !== undefined ? type : Math.floor(Math.random()*5);
    this.color = Wugl.Color.force(color || [Math.random(),Math.random(),Math.random()]);
    this.normalmap = null;
    this.heightmap = null;
    this.depthmap = null;
    this.ambientocclusion = null;
    this.heightsamp = 5;
    this.heightmultiplier = 0.05;
    this.heightoffset = 1.0;
    this.normalstrength = 1.0;
    //this.id = textures.length;
    //this.matStr = "material"+id;
    this.ior = 1.5;
    this.concentration = 0.5;
    this.intensity = 3.0;
    this.emissive = false;
    this.glossiness = 0.6;
    this.diffuse = 0.5;
    this.roughness = null;
    this.texScale = 1;
    this.filmwidth = 1000;
    this.iridescence = false;
    materials.push(this);
  }
  getColor(scene,obj) {
    if (this.color instanceof Texture) {
      return `
  surfaceColor = ${this.color.texture2D(`uv.xy * ${toFloat(this.texScale)}`,scene)}.rgb;
      `;
    }
    if (this.color instanceof Array) {
      return `
  surfaceColor = ${toVec(3,this.color)};
    `;
    }
    if (this.color instanceof Vector) {
      return `
  surfaceColor = ${toVec(3,this.color)};
    `;
    }
    if (typeof this.color === 'number') {
      return `
  surfaceColor = vec3(${toFloat(this.color)});
    `;
    }
    if (typeof this.color === 'string') {
      return this.color;
    }
    if (typeof this.color === 'function') {
      return this.color(scene,obj);
    }
    return '';
  }
  getNormals(obj) {
    if (this.normalmap instanceof Texture) {
      return `
   
    // Create tangent basis vectors
    //vec3 normal2 = normalize((vec4(normal,0)*transpose(${obj.transformStr})).xyz);
    
    vec3 tangent = cross(normal2,vec3(0.0,0.0,1.0));
    float abstan = length(tangent);
    tangent = abstan < EPSILON ? vec3(1.0,0.0,0.0) : tangent / abstan;
    vec3 binormal = normalize(cross(normal2,tangent));
    
    mat3 TBN = mat3(tangent, binormal, normal2);

    ${this.getHeightMap(obj)}
    ${this.getDepthMap(obj)}

    vec3 mappednormal = ${this.normalmap.texture2D(`uv.xy * ${toFloat(this.texScale)}`)}.rgb * 2. - 1.;

    ${this.normalstrength!==1?`mappednormal = normalize(mappednormal*vec3(1,${toFloat(this.normalstrength)},1));`:''}

    // Transform mapped normal to world space
    mappednormal = normalize(TBN * mappednormal);
    
    ${(obj.transformInvStr ? `mappednormal = normalize((vec4(mappednormal,0)*transpose(${obj.transformInvStr})).xyz);` : '')}

    normal = dot(normalize(ray), mappednormal) > 0. ? normal : mappednormal;
    //break;
    
      `;
    }
    if (typeof this.normalmap === 'string') {
      return this.normalmap;
    }
    return '';
  }
  getHeightMap(obj) {
    if (this.heightmap instanceof Texture) {
      return `
    
    //vec3 viewDir = normalize(transpose(TBN) * ray/lray);
    //vec3 viewDir = normalize((vec4(normalize(ray),0) * transpose(${obj.transformStr})).xyz);
    ${(obj.transformInvStr ? `
    vec3 viewDir = normalize((vec4(normalize(ray),0) * ${obj.transformInvStr}).xyz);
    viewDir = normalize(transpose(TBN) * viewDir);
    ` : `
    vec3  viewDir = normalize(transpose(TBN) * normalize(ray));
    `)}
    
    /*
    
    float height = ${this.heightmap.texture2D(`uv.xy * ${toFloat(this.texScale)}`)}.r; 
    vec2 p = viewDir.xy / viewDir.z * (height * ${toFloat(this.heightmultiplier)});
    uv = uv - p;

    /*/

    const float numLayers = ${this.heightsamp}.;
    float layerDepth = 1.0 / numLayers;
    float cdepth = 0.0;
    vec2 p = viewDir.xy / viewDir.z * ${toFloat(this.heightmultiplier)};

    uv = uv + p * ${toFloat(this.heightoffset)};
    
    p = p * layerDepth; 
    
    //float oldheight = 0.0;
    float cheight = (1.-${this.heightmap.texture2D(`uv.xy * ${toFloat(this.texScale)}`)}.r);

    for (int i = 0; i < int(numLayers); i++) {
      uv -= p;
      //oldheight = cheight;
      cheight = 1.-${this.heightmap.texture2D(`uv.xy * ${toFloat(this.texScale)}`)}.r;
      cdepth += layerDepth;  
      if (cdepth > cheight) break;
    }

    float afterDepth  = cheight - cdepth;
    float beforeDepth = (1.-${this.heightmap.texture2D(`uv.xy * ${toFloat(this.texScale)} + p`)}.r) - cdepth + layerDepth;

    // interpolation of texture coordinates
    float weight = afterDepth / (afterDepth - beforeDepth);
    uv = (uv + p) * weight + uv * (1.0 - weight);

    //*/

    //surfaceColor = vec3(p.x,p.y,0);
    
      `;
    }
    if (typeof this.heightmap === 'string') {
      return this.heightmap;
    }
    return '';
  }
  getDepthMap(obj) {
    if (this.depthmap instanceof Texture) {
      return `
    
    //vec3 viewDir = normalize(transpose(TBN) * ray/lray);
    //vec3 viewDir = normalize((vec4(normalize(ray),0) * transpose(${obj.transformStr})).xyz);
    ${(obj.transformInvStr ? `
    vec3 viewDir = normalize((vec4(normalize(ray),0) * ${obj.transformInvStr}).xyz);
    viewDir = normalize(transpose(TBN) * viewDir);
    ` : `
    vec3  viewDir = normalize(transpose(TBN) * normalize(ray));
    `)}
    
    /*
    
    float height = ${this.depthmap.texture2D(`uv.xy * ${toFloat(this.texScale)}`)}.r; 
    vec2 p = viewDir.xy / viewDir.z * (height * ${toFloat(this.heightmultiplier)});
    uv = uv - p;

    /*/

    const float numLayers = ${this.heightsamp}.;
    float layerDepth = 1.0 / numLayers;
    float cdepth = 0.0;
    vec2 p = viewDir.xy / viewDir.z * ${toFloat(this.heightmultiplier)}; 

    if (inside) {
      p *= -1.;
      uv += p;
    }
    
    p *= layerDepth;
    
    //float oldheight = 0.0;
    float cheight = ${this.depthmap.texture2D(`uv.xy * ${toFloat(this.texScale)}`)}.r;
    if (inside) cheight = 1. - cheight;

    for (int i = 0; i < int(numLayers); i++) {
      uv -= p;
      //oldheight = cheight;
      cheight = ${this.depthmap.texture2D(`uv.xy * ${toFloat(this.texScale)}`)}.r;
      if (inside) cheight = 1. - cheight;
      cdepth += layerDepth;  
      if (cdepth > cheight) break;
    }

    float afterDepth  = cheight - cdepth;
    float olddepth = ${this.depthmap.texture2D(`uv.xy * ${toFloat(this.texScale)} + p`)}.r;
    if (inside) olddepth = 1. - olddepth;
    float beforeDepth = olddepth - cdepth + layerDepth;

    // interpolation of texture coordinates
    float weight = afterDepth / (afterDepth - beforeDepth);
    uv = (uv + p) * weight + uv * (1.0 - weight);

    //*/

    //surfaceColor = vec3(p.x,p.y,0);
    
      `;
    }
    if (typeof this.depthmap === 'string') {
      return this.depthmap;
    }
    return '';
  }
  getAmbientOcclusion() {
    if (this.ambientocclusion instanceof Texture) {
      return `colorMask *= ${this.ambientocclusion.texture2D(`uv.xy * ${toFloat(this.texScale)}`)}.b;`;
    }
    if (typeof this.ambientocclusion === 'string') {
      return this.ambientocclusion;
    }
    return '';
  }
  /*getSelfReflection() {
    if (this.depthmap instanceof Texture) {
      return `
    
    vec3 outray = normalize(transpose(TBN) * ray);
    
    vec2 ouv = uv.xy;
    cheight = 1.-${this.depthmap.texture2D(`ouv.xy * ${toFloat(this.texScale)} + p`)}.r;
    cdepth = cheight;
    float odepth = (1.-cdepth) / numLayers;
    
    p = outray.xy / outray.z * ${toFloat(this.heightmultiplier)} * odepth; 

    for (int i = 0; i < int(numLayers); i++) {
      ouv += p;
      cheight = 1.-${this.depthmap.texture2D(`ouv.xy * ${toFloat(this.texScale)} + p`)}.r;
      cdepth += odepth;
      if (cdepth < cheight) {
        shadowIntensity = 0.;
        break;
      }
    }
    
      `;
    }
    if (this.heightmap instanceof Texture) {
      return `
    
    vec3 ntolight = normalize(transpose(TBN) * toLight);
    
    vec2 luv = uv.xy;
    cheight = ${this.heightmap.texture2D(`luv.xy * ${toFloat(this.texScale)} + p`)}.r;
    cdepth = cheight;
    float ldepth = (1.-cdepth) / numLayers;
    
    p = ntolight.xy / ntolight.z * ${toFloat(this.heightmultiplier)} * ldepth; 

    for (int i = 0; i < int(numLayers); i++) {
      luv += p;
      cheight = ${this.heightmap.texture2D(`luv.xy * ${toFloat(this.texScale)} + p`)}.r;
      cdepth += ldepth;
      if (cdepth < cheight) {
        shadowIntensity = 0.;
        break;
      }
    }
    
      `;
    }
    return '';
  }*/
  newDiffuseRay(scene,obj) {
    var self = this;
    return `
 ray = cosineWeightedDirection(timeSinceStart + float(bounce), normal);

 colorMask *= surfaceColor;
 ${scene.lights.map(v=>v.lambertianLight(self,obj,scene)).join('')}

 //origin = hit + normal*EPSILON;
 origin = hit + ray*EPSILON;

 //extinctionColor = vec3(0.);
 //emissiveExtinctionColor = vec3(0.);

 ${this.emissive?`accumulatedColor += colorMask * surfaceColor * ${toFloat(this.intensity)};`:''}

  lightUp2 = true;
  lightUp1 = false;

  reducebounce++;
`;
  }
  newReflectiveRay(scene,obj) {
    var self = this;
    return `
 ray = normalize(ray);

 float kr = 1.;
 float ior = ${toFloat(self.ior)};
 
 normal = dot(ray, normal) > 0. ? -normal : normal;
 
 fresnel(ray,normal,ior,1.,kr);

 colorMask *= dot(ray, normal) > 0. ? 0. : 1.;

 ray = normalize(reflect(ray, normal));

 colorMask *= 1. - (1. - surfaceColor) * (1. - kr);
 ${scene.lights.map(v=>v.specularLight(self,obj,scene)).join('')}
  
 //origin = hit + normal*EPSILON;
 origin = hit + ray*EPSILON;
 
 //extinctionColor = vec3(0.);
 //emissiveExtinctionColor = vec3(0.);

 ${self.emissive?`accumulatedColor += colorMask * surfaceColor * ${toFloat(self.intensity)};`:''}
  
   if (lightUp2) lightUp1 = true;
    `;
  }
  getGlossiness() {
    if (this.glossiness instanceof Texture) {
      return `${this.glossiness.texture2D(`uv.xy * ${toFloat(this.texScale)}`)}.r`;
    }
    if (this.roughness instanceof Texture) {
      return `(1.-${this.roughness.texture2D(`uv.xy * ${toFloat(this.texScale)}`)}.r)`;
    }
    switch (typeof this.glossiness) {
      case 'string':
        return this.glossiness;
      case 'number':
        return toFloat(this.glossiness);
    }
    return '0.6';
  }
  newGlossyRay(scene,obj) {
    var self = this;
    return `

 //ray = normalize(ray);
  
 //float kr = 1.;
 //float ior = ${toFloat(this.ior)};
 //fresnel(ray,normal+uniformlyRandomVector(timeSinceStart + float(bounce)),ior,1.,kr);

 ray = normalize(reflect(ray, normal)) + uniformlyRandomVector(timeSinceStart + float(bounce)) * ${this.getGlossiness()};

 //colorMask *= 1. - (1. - surfaceColor) * (1. - kr);
 
 colorMask *= surfaceColor;
 ${scene.lights.map(v=>v.lambertianLight(self,obj,scene)).join('')}
 
 //origin = hit + normal*EPSILON;
 origin = hit + ray*EPSILON;

 //extinctionColor = vec3(0.);
 //emissiveExtinctionColor = vec3(0.);

 ${this.emissive?`accumulatedColor += colorMask * surfaceColor * ${toFloat(this.intensity)};`:''}

  lightUp2 = true;
  lightUp1 = false;

  reducebounce++;
`;
  }
  newSmoothRay(scene,obj) {
    var self = this;
    return `
 float kr = 1.;
 float ior = ${toFloat(this.ior)};

  ray = normalize(ray);

  fresnel(ray,normal,ior,1.,kr);
  float rand = random(vec3(241.2234,87.4223,23.4567),timeSinceStart + float(bounce));
  //float rand = random2(vec2(87.4223,23.4567),timeSinceStart + float(bounce));

 if (rand < kr) {
   ray = normalize(reflect(ray, normal));
   ${scene.lights.map(v=>v.specularLight(self,obj,scene)).join('')}
   //origin = hit + normal*EPSILON;
   origin = hit + ray*EPSILON;
   if (lightUp2) lightUp1 = true;
 } else {
   ${this.newDiffuseRay(scene,obj)}
 }
   
  
    `;
  }
  newRefractiveRay(scene,obj) {
    var self = this;
    return `
 float kr = 1.;
 float ior = ${toFloat(this.ior)};
 float concentration = ${toFloat(this.concentration)};

  ray = normalize(ray);

  fresnel(ray,normal,ior,1.,kr);
  float rand = random(vec3(241.2234,87.4223,23.4567),timeSinceStart + float(bounce));
  //float rand = random2(vec2(87.4223,23.4567),timeSinceStart + float(bounce));

 if (rand < kr) {
   //return vec3(kr,kr,1);
   normal = dot(ray, normal) > 0. ? -normal : normal;
   ray = normalize(reflect(ray, normal));
   ${scene.lights.map(v=>v.specularLight(self,obj,scene)).join('')}
   //origin = hit + normal*EPSILON;
   origin = hit + ray*EPSILON;
   //extinctionColor = vec3(0.);
   //emissiveExtinctionColor = vec3(0.);
 } else {
   //return vec3(kr,kr,0);
   //return vec3(0,0,0);
   ray = normalize(refraction(ray, normal, ior, 1.));
   origin = hit + ray*EPSILON;
   extinctionColor = inside ? vec3(0.) : (vec3(1.) - surfaceColor) * concentration;
  ${this.emissive?`emissiveExtinctionColor = inside ? vec3(0.) : surfaceColor * ${toFloat(this.intensity)} * concentration;`:`emissiveExtinctionColor = vec3(0.);`}
   iorA = inside ? 1. : ior;
   reducebounce--;
 }
   
  if (lightUp2) lightUp1 = true;
  
    `;
  }
  newBubbleRay(scene,obj) {
    var self = this;
    return `
 float kr = 1.;
 float ior = ${toFloat(this.ior)};

  ray = normalize(ray);

  normal = dot(ray, normal) > 0. ? -normal : normal;

  fresnel(ray,normal,ior,1.,kr);
  float rand = random(vec3(241.2234,87.4223,23.4567),timeSinceStart + float(bounce));
  //float rand = random2(vec2(87.4223,23.4567),timeSinceStart + float(bounce));

 if (rand < kr) {
   //return vec3(kr,kr,1);
   ${this.iridescence?`colorMask *= iridescence(ray,normal,ior,${toFloat(this.filmwidth)});`:''}
   ray = normalize(reflect(ray, normal));
   ${scene.lights.map(v=>v.specularLight(self,obj,scene)).join('')}
   //origin = hit + normal*EPSILON;
   origin = hit + ray*EPSILON;
   //extinctionColor = vec3(0.);
   //emissiveExtinctionColor = vec3(0.);
   //if (lightUp2) lightUp1 = true;
 } else {
   //return vec3(kr,kr,0);
   //return vec3(0,0,0);
   origin = hit + ray*EPSILON;
  ${this.emissive?`emissiveExtinctionColor = inside ? vec3(0.) : surfaceColor * ${toFloat(this.intensity)} * concentration;`:`emissiveExtinctionColor = vec3(0.);`}
   iorA = inside ? 1. : ior;
   reducebounce--;
 }
  
    `;
  }
  newEmissiveRay(scene) {
    return `
  accumulatedColor += colorMask * surfaceColor * ${toFloat(this.intensity)};
  break;
    `;
  }
  getCode(scene,obj) {
    return `
   ${this.getNormals(obj)}
   // color:
   ${this.getColor(scene,obj)}
   ${[this.newDiffuseRay, this.newReflectiveRay, this.newGlossyRay, this.newRefractiveRay,this.newSmoothRay,this.newBubbleRay,this.newEmissiveRay][this.type].apply(this,[scene,obj])}
   ${this.getAmbientOcclusion()}
    `;
  }
  getGlobalCode() {
    return ``;
  }
}

class Background {
  constructor(preset) {
    this.skybox = [0.8,0.9,1.0];
    //this.skybox = [0,0,0];
    this.skyboxMult = 1.0;
    this.atmosphere = false;
    this.groundHeight = -1;
    this.material = new Material(0);
    switch (preset) {
      case 0: 
        this.cornellBox = false;
        this.groundPlane = true;
        this.material.color = gridPlaneColor;
      break;
      case 1:
        this.cornellBox = true;
        this.groundPlane = false;
        this.material.color = yellowBlueCornellBox;
      break;
      case 2: 
        this.cornellBox = true;
        this.groundPlane = false;
        this.material.color = redGreenCornellBox;
      break;
      case 3: 
        this.cornellBox = false;
        this.groundPlane = false;
        this.material.color = false;
      break;
    }
  }
  getIntersectCode() {
    if (this.cornellBox)
      return `vec2 tRoom = intersectCube(origin, ray, roomCubeMin, roomCubeMax);`;
    if (this.groundPlane) 
      return `float tGround = intersectGround(origin, ray, ${toFloat(this.groundHeight)});`;
    return '';
  }
  getMinimumIntersectCode() {
    if (this.cornellBox) 
      return `if (tRoom.x < tRoom.y) t = tRoom.y;`;
    if (this.groundPlane)
      return `if (tGround > 0.) t = tGround;`;
    return '';
  }
  getNormalCalculationCode() {
    if (this.cornellBox) 
      return `if(t == tRoom.y) {
       normalForCube0(normal, uv, hit, roomCubeMin, roomCubeMax);
       normal = -1. * normal;
       normal2 = normal;
       inside = false;
       ${this.material.getNormals(this)}
     } else `;
    if (this.groundPlane) 
      return `if (t == tGround) {
       uv = hit.xz;
       uv = vec2(uv.x,-uv.y);
       normal = vec3(0,1,0);
       normal2 = normal;
       inside = origin.y < ${toFloat(this.groundHeight)};
       ${this.material.getNormals(this)}
     } else `;
    return ''; 
  }
  getHitCheck(scene) {
    if (this.cornellBox) 
      return `if(t == tRoom.y) {
       normalForCube0(normal, uv, hit, roomCubeMin, roomCubeMax);
       normal = -1. * normal;
       normal2 = normal;
       inside = false;
       ${this.material.getCode(scene,this)}
     } else `;
    if (this.groundPlane) 
      return `if (t == tGround) {
       uv = hit.xz;
       uv = vec2(uv.x,-uv.y);
       normal = vec3(0,1,0);
       normal2 = normal;
       inside = origin.y < ${toFloat(this.groundHeight)};
       ${this.material.getCode(scene,this)}
     } else `;
    return '';
  }
  getSkybox() {
    if (typeof this.skybox == 'string') return this.skybox;
    if (this.cornellBox) return '';
    if (this.skybox instanceof Texture) 
      return `
    ray = normalize(ray);
    uv = vec2(0.5 + atan(ray.z, ray.x) / TWO_PI, asin(ray.y) / PI - 0.5);
    accumulatedColor += colorMask * ${this.skybox.texture2D(`uv.xy`)}.rgb * ${toFloat(this.skyboxMult)};`;
    if (this.atmosphere) return 'break;';
    if (this.skybox instanceof Array)  
      return `accumulatedColor += colorMask * ${toVec(3,this.skybox)} * ${toFloat(this.skyboxMult)};`;
    return '';
  }
  getAtmosphere(scene) {
    if (!this.atmosphere) return '';
    var sun = scene.lights[0];
    return `
      const float Hr = 7994.;
      const float Hm = 1200.;
      const float earthRadius = 6360e3;
      const float atmosphereRadius = 6420e3;
      const vec3 betaR = vec3(3.8e-6, 13.5e-6, 33.1e-6);
      const vec3 betaM = vec3(21e-6);

      vec3 toSun = ${sun.getToLightNormal()};

      vec3 sumR = vec3(0);
      vec3 sumM = vec3(0);
      float opticalDepthR = 0.;
      float opticalDepthM = 0.;
      vec3 nray = ray/lray;
      float mu = dot(nray, toSun);
      float phaseR = 3. / (16. * PI) * (1. + mu * mu); 
      const float g = 0.76;
      float denom = 1. + g * g - 2. * g * mu;
      float phaseM = 3. / (8. * PI) * ((1. - g * g) * (1. + mu * mu)) / ((2. + g * g) * denom * sqrt(denom)); 
      vec3 earthCenter = vec3(origin.x,-earthRadius+${toFloat(this.groundHeight)},origin.z);
        
      bool ins = true;
      float ts = intersectSphere(origin, nray, earthCenter, atmosphereRadius, ins);
      float dist = min(t*lray,ts);
      
      float stride = dist / 16.;
      for (int i = 0; i < 16; i++) {
        float rand = random(vec3(151.7242, 14.098, 92.3421), timeSinceStart + float(i)/16.);
        float tsamp = stride * (float(i) + rand);
        vec3 sample_pos = origin + tsamp * nray;
        float Lshad = shadow(sample_pos, toSun * INFINITY);
        
        if (Lshad < 0.) continue;

        float height = distance(sample_pos,earthCenter)-earthRadius;
        float hr = exp(-height / Hr) * stride; 
        float hm = exp(-height / Hm) * stride; 
        opticalDepthR += hr; 
        opticalDepthM += hm; 

        bool Lins;
        float Lts = intersectSphere(sample_pos, toSun, vec3(0,-earthRadius,0), atmosphereRadius, Lins);

        float Lstride = Lts / 1.;
        float opticalDepthLightR = 0.; 
        float opticalDepthLightM = 0.; 
        float rand2 = random(vec3(72.1231, 16.621, 85.3212), timeSinceStart + float(i)/16.);
        for (int j = 0; j < 8; j++) {
          float t_light = Lstride * (float(j) + rand2);
          vec3 light_sample_pos = sample_pos + toSun * t_light;
          float heightLight = distance(light_sample_pos,earthCenter)-earthRadius;
          opticalDepthLightR += exp(-heightLight / Hr) * Lstride; 
          opticalDepthLightM += exp(-heightLight / Hm) * Lstride; 
        }

        vec3 tau = betaR * (opticalDepthR + opticalDepthLightR) + betaM * 1.1 * (opticalDepthM + opticalDepthLightM);
        vec3 attenuation = exp(-tau) * Lshad; 
        sumR += attenuation * hr; 
        sumM += attenuation * hm;
      }
      
      //colorMask *= shadow(origin + dist * nray, toSun * INFINITY);
      
      accumulatedColor += ${sun.getRawIntensity(scene)} * colorMask * (sumR * betaR * phaseR + sumM * betaM * phaseM) * 20.;
      vec3 totalTau = betaR * opticalDepthR + betaM * 1.1 * opticalDepthM;
      colorMask *= exp(-totalTau);
      `;
  }
}

var defaultbackground = new Background(1);

function forceVector(list) {
  return Wugl.Vector.force(list,3);
}

function transformVector(vector,w,matrix) {
  return matrix.applyV(vector,w);
}

class TracerObject {
  constructor(id, material) {
    this.id = id;
    this.type = "Object";
    this.material = material || new Material();
    this.temporaryTranslation = new Vector([0, 0, 0]);
    this.transformation = new Transform();
    this.objectTransformation = new Transform();
    this.selectable = true;
  }
  temporaryTranslate(translation) {
    this.temporaryTranslation = translation;
  }
  get transformStr() {return 'transform' + this.type + this.id;}
  get transformInvStr() {return 'transformInv' + this.type  + this.id;}
  get normalStr() {return 'normal' + this.type + this.id;}
  get normal2Str() {return 'normal2' + this.type + this.id;}
  get uvStr() {return 'uv' + this.type + this.id;}
  get insideStr() {return 'inside' + this.type + this.id;}
  get intersectStr() {return 't' + this.type + this.id;}
  get minStr() {return 'min' + this.type + this.id;}
  get maxStr() {return 'max' + this.type + this.id;}
  getGlobalCode(scene) {
    return `
      uniform mat4 ${this.transformStr};
      uniform mat4 ${this.transformInvStr};
      uniform vec3 ${this.minStr};
      uniform vec3 ${this.maxStr};
      ${this.getGlobalCode2(scene)||''}`;
  }
  getNormalCalculationCode() {
    return `
       else if (t == ${this.intersectStr}) {
         normal = ${this.normalStr};
         normal2 = ${this.normal2Str};
         uv = ${this.uvStr};
         inside = ${this.insideStr};
         ${this.material.getNormals(this)}
       }`;
  }
  getHitCheck(scene) {
    return `
       else if (t == ${this.intersectStr}) {
         normal = ${this.normalStr};
         normal2 = ${this.normal2Str};
         uv = ${this.uvStr};
         inside = ${this.insideStr};
         ${this.material.getCode(scene,this)}
       }`;
  }
  getIntersectCode(scene) {
    var id = this.id;
    var d = scene?.debug == "colorMask" ? "" : "//";
    return `
      bool ${this.insideStr} = false;
      vec3 ${this.normalStr} = vec3(1.);
      vec3 ${this.normal2Str} = vec3(1.);
      vec2 ${this.uvStr} = vec2(0.);
      float ${this.intersectStr} = -1.;
      if (intersectBox(origin, 1./ray, ${this.minStr}, ${this.maxStr}, t)) {
      vec3 Torigin${id} = (vec4(origin,1.) * ${this.transformInvStr}).xyz;
      vec3 Tray${id} = normalize((vec4(ray/lray,0.) * ${this.transformInvStr}).xyz);
      ${this.getObjectIntersect('Torigin'+id,'Tray'+id)}
      if (${this.intersectStr} > 0.) {
        ${d} colorMask *= 0.95;
        vec3 Thit${id} = Torigin${id}+Tray${id}*${this.intersectStr};
        ${this.applyNormals('Thit'+id,'Tray'+id)}
        vec3 hit${id} = (vec4(Thit${id},1.) * ${this.transformStr}).xyz;
        ${this.normalStr} = normalize((vec4(${this.normal2Str},0.) * transpose(${this.transformInvStr})).xyz);
        ${this.intersectStr} = distance(origin, hit${id}) / lray;
        if (${this.intersectStr} < t) t = ${this.intersectStr};
      }
      ${d} else {colorMask *= 0.9;}
      }`;
  }
  getShadowTestCode(scene) {
    return this.material.type == 5 ? `
      ${this.getIntersectCode(scene)}
      if (${this.intersectStr} > 0.0 && ${this.intersectStr} < 1.0) {
        float kr = 1.;
        float ior = ${toFloat(this.material.ior)};
        vec3 nray = ray/lray;
        ${this.normalStr} = dot(nray, ${this.normalStr}) > 0. ? -${this.normalStr} : ${this.normalStr};
        fresnel(nray,${this.normalStr},ior,1.,kr);
        shadowIntensity *= 1. - kr;
      }
    ` :`
      ${this.getIntersectCode(scene)}
      if(${this.intersectStr} > 0.0 && ${this.intersectStr} < 1.0) return 0.0;`;
  }
  getMinimumIntersectCode() {
    //return `
    //   if(${this.intersectStr} > 0.0 && ${this.intersectStr} < t) t = ${this.intersectStr};`;
    return '';
  }
  setUniforms(renderer) {
    var transform = this.tempTransform;
    renderer.uniforms[this.transformStr] = transform;
    renderer.uniforms[this.transformInvStr] = transform.inverse();
    renderer.uniforms[this.minStr] = this.getMinCorner();
    renderer.uniforms[this.maxStr] = this.getMaxCorner();
    this.setUniforms2(renderer);
  }
  getTransform() {
    return this.transformation;
  }
  setTransform(elements) {
    this.transformation = elements;
  }
  translate(t) {this.transformation.translate(t);}
  rotate(a,v) {this.transformation.rotate(a,v);}
  rotateX(a) {this.transformation.rotateX(a);}
  rotateY(a) {this.transformation.rotateY(a);}
  rotateZ(a) {this.transformation.rotateZ(a);}
  scale(s) {this.transformation.scale(s);}
  shear(s) {this.transformation.shear(s);}
  skew(s) {this.transformation.skew(s);}
  get tempTransform() {
    return Transform.Translation(this.temporaryTranslation)
      .multiply(this.transformation)
      .multiply(this.objectTransformation);
  }
  getCorners() {
    var a = this.getMinCorner2();
    var b = this.getMaxCorner2();
    var list = [
      [a[0],a[1],a[2]],
      [a[0],a[1],b[2]],
      [a[0],b[1],a[2]],
      [b[0],a[1],a[2]],
      [a[0],b[1],b[2]],
      [b[0],b[1],a[2]],
      [b[0],a[1],b[2]],
      [b[0],b[1],b[2]],
    ];
    var transform = this.tempTransform;
    list = list.map(v=>transformVector(v,1,transform));
    return list;
  }
  getMinCorner() {
    var list = this.getCorners();
    var mins = [Infinity,Infinity,Infinity];
    for (var j = 0; j < list.length; j++) {
      for (var i = 0; i < 3; i++) {
        mins[i] = Math.min(mins[i],list[j][i]);
      }
    }
    return new Vector(mins);
  }
  getMaxCorner() {
    var list = this.getCorners();
    var maxes = [-Infinity,-Infinity,-Infinity];
    for (var j = 0; j < list.length; j++) {
      for (var i = 0; i < 3; i++) {
        maxes[i] = Math.max(maxes[i],list[j][i]);
      }
    }
    return new Vector(maxes);
  }
  getMinCorner2() {
    //return new Vector([-this.radius, -this.height/2, -this.radius]);
    return new Vector([-1, -1, -1]);
  }
  getMaxCorner2() {
    //return new Vector([this.radius, this.height/2, this.radius]);
    return new Vector([1, 1, 1]);
  }
  getCenter() {
    var a = this.getMinCorner2();
    var b = this.getMaxCorner2();
    var c = a.add(b).multiply(0.5);
    var transform = this.tempTransform;
    return transformVector(c,1,transform);
  }
  getDistanceSq(point) {
    var v = this.getCenter().subtract(point);
    return v.dot(v);
  }
  getArea() {
    var maxes = this.getMaxCorner();
    var mins = this.getMinCorner();
    var size = (maxes.subtract(mins));
    return size[0]*size[1]+size[1]*size[2]+size[0]*size[2];
  }
  intersect(origin, ray) {
    //origin = transformVector(origin,1,transform);
    //ray = transformVector(ray,0,transform).normalize();
    return Cube.intersect(origin, ray, this.getMinCorner(), this.getMaxCorner());
    //return Torus.intersect(origin, ray, this.center.add(this.temporaryTranslation), this.radius);
  }
}


class NodeObject extends TracerObject {
  constructor(id, objects, material) {
    super(id, material);
    this.type = "Node";
  }
  getGlobalCode2() {
    return '';
  }
  getObjectIntersect(origin,ray) {
    return `
      ${this.intersectStr} = intersectSphere(${origin}, ${ray}, ${this.insideStr});`;
  }
  applyNormals(hit,ray) {
    return `
      normalForSphere(${this.normal2Str}, ${this.uvStr}, ${hit});`;
  }
  setUniforms2(renderer) {
  	
  }
}

class Sphere extends TracerObject {
  constructor(id, center, radius, material) {
    super(id, material);
    this.type = "Sphere";
    this.objectTransformation = Transform.Translation(center).multiply(Transform.Scale(radius));
  }
  getGlobalCode2() {
    return '';
    // return `
    //   uniform vec3 ${this.centerStr};
    //   uniform float ${this.heightStr};
    //   uniform float ${this.radiusStr};`;
  }
  getObjectIntersect(origin,ray) {
    return `
      ${this.intersectStr} = intersectSphere(${origin}, ${ray}, ${this.insideStr});`;
  }
  applyNormals(hit,ray) {
    return `
      //normalForCylinder(${this.normal2Str}, ${this.uvStr}, ${hit}, ${this.centerStr}, ${this.radiusStr}, ${this.heightStr});
      normalForSphere(${this.normal2Str}, ${this.uvStr}, ${hit});
      //${this.insideStr} = dot(${ray},${this.normal2Str}) > 0.;`;
  }
  setUniforms2(renderer) {
    // renderer.uniforms[this.centerStr] = this.center.add(this.temporaryTranslation);
    // renderer.uniforms[this.radiusStr] = this.radius;
  }
}

class Cylinder extends TracerObject {
  constructor(id, center, radius, height, material) {
    super(id, material);
    this.type = "Cylinder";
    // this.center = forceVector(center);
    this.objectTransformation = Transform.Translation(center).multiply(Transform.Scale([radius,height,radius]));
    // this.radius = radius;
    // this.height = height;
  }
  getGlobalCode2() {
    return '';
    // return `
    //   uniform vec3 ${this.centerStr};
    //   uniform float ${this.heightStr};
    //   uniform float ${this.radiusStr};`;
  }
  getObjectIntersect(origin,ray) {
    return `
      //float ${this.intersectStr} = intersectCylinder(${origin}, ${ray}, ${this.centerStr}, ${this.radiusStr}, ${this.heightStr}, ${this.normalStr}, ${this.insideStr});
      ${this.intersectStr} = intersectCylinder(${origin}, ${ray}, ${this.insideStr});`;
  }
  applyNormals(hit,ray) {
    return `
      //normalForCylinder(${this.normal2Str}, ${this.uvStr}, ${hit}, ${this.centerStr}, ${this.radiusStr}, ${this.heightStr});
      normalForCylinder(${this.normal2Str}, ${this.uvStr}, ${hit});
      ${this.insideStr} = dot(${ray},${this.normal2Str}) > 0.;`;
  }
  setUniforms2(renderer) {
    // renderer.uniforms[this.centerStr] = this.center.add(this.temporaryTranslation);
    // renderer.uniforms[this.radiusStr] = this.radius;
    // renderer.uniforms[this.heightStr] = this.height/2;
  }
}

class Cone extends TracerObject {
  constructor(id, center, radius, radius2, height, material) {
    super(id, material);
    this.type = "Cone";
    var center = forceVector(center);
    this.objectTransformation = new Transform([
      [radius,0,0,center[0]],
      [0,height*2,0,center[1]-height],
      [0,0,radius,center[2]],
      [0,0,0,1],
    ]);
    this.top = radius2/radius;
    // this.center = forceVector(center);
    // this.radius = radius;
    // this.height = height;
  }
  get topStr() { return 'topCone'+this.id; }
  getGlobalCode2() {
    return `
      uniform float ${this.topStr};
    `;
    // return `
    //   uniform vec3 ${this.centerStr};
    //   uniform float ${this.heightStr};
    //   uniform float ${this.radiusStr};`;
  }
  getObjectIntersect(origin,ray) {
    return `
      //float ${this.intersectStr} = intersectCone(${origin}, ${ray}, ${this.centerStr}, ${this.radiusStr}, ${this.heightStr}, ${this.normalStr}, ${this.insideStr});
      ${this.intersectStr} = intersectCone(${origin}, ${ray}, ${this.topStr}, ${this.normal2Str}, ${this.uvStr}, ${this.insideStr});`;
  }
  applyNormals(hit,ray) {
    return `
      //normalForCone(${this.normal2Str}, ${this.uvStr}, ${hit}, ${this.centerStr}, ${this.radiusStr}, ${this.heightStr});
      //normalForCone(${this.normal2Str}, ${this.uvStr}, ${hit});
      ${this.insideStr} = dot(${ray},${this.normal2Str}) > 0.;`;
  }
  setUniforms2(renderer) {
    // renderer.uniforms[this.centerStr] = this.center.add(this.temporaryTranslation);
    // renderer.uniforms[this.radiusStr] = this.radius;
    // renderer.uniforms[this.heightStr] = this.height/2;
    renderer.uniforms[this.topStr] = this.top;
  }
  getMinCorner2() {
    return new Vector([-1,0,-1]);
  }
  getMaxCorner2() {
    return new Vector([1,1,1]);
  }
}

class Torus extends TracerObject {
  constructor(id, center, shape, material) {
    super(id, material);
    this.type = "Torus";
    center = forceVector(center);
    this.objectTransformation = Transform.Translation(center);
    this.shape = shape;
    /*this.centerStr = 'torusCenter' + id;
    this.shapeStr = 'torusShape' + id;
    this.intersectStr = 'tTorus' + id;
    this.insideStr = 'iTorus' + id;*/
  }
  get shapeStr() {return 'torusShape' + this.id;}
  getGlobalCode2() {
    return `
      uniform vec2 ${this.shapeStr};`;
  }
  getObjectIntersect(origin,ray) {
    var id = this.id;
    return `
      ${this.intersectStr} = intersectTorus(${origin}, ${ray}, ${this.shapeStr}, ${this.insideStr});`;
  }
  applyNormals(hit,ray) {
    var id = this.id;
    return `
      normalForTorus(${this.normal2Str}, ${this.uvStr}, ${hit}, ${this.shapeStr});
      ${this.insideStr} = dot(${ray},${this.normal2Str}) > 0.;`;
  }
  setUniforms2(renderer) {
    renderer.uniforms[this.shapeStr] = this.shape;
  }
  getMinCorner2() {
    return new Vector([-this.shape[0]-this.shape[1], -this.shape[0]-this.shape[1], -this.shape[1]]);
  }
  getMaxCorner2() {
    return new Vector([this.shape[0]+this.shape[1], this.shape[0]+this.shape[1], this.shape[1]]);
  }
}

class Cube extends TracerObject {
  constructor(id, minCorner, maxCorner, material) {
    super(id,material);
    var minCorner = forceVector(minCorner);
    var maxCorner = forceVector(maxCorner);
    var size = maxCorner.subtract(minCorner).map((v)=>v/2);
    var center = minCorner.add(maxCorner).map((v,i)=>v/2);
    this.objectTransformation = Transform.Translation(center).multiply(Transform.Scale(size));
    /*this.minStr = 'cubeMin' + id;
    this.maxStr = 'cubeMax' + id;
    this.intersectStr = 'tCube' + id;*/
    this.type = "Cube";
  }
  //get minStr() {return 'cubeMin' + this.id;}
  //get maxStr() {return 'cubeMax' + this.id;}
  getGlobalCode2() {
    return '';
    //return `
    //  uniform vec3 ${this.minStr};
    //  uniform vec3 ${this.maxStr};`;
  }
  getObjectIntersect(origin,ray) {
    var id = this.id;
    return `
      ${this.intersectStr} = intersectCube(${origin}, ${ray},  ${this.insideStr});`;
  }
  applyNormals(hit,ray) {
    var id = this.id;
    return `
      normalForCube1(${this.normal2Str}, ${this.uvStr}, ${hit});
      `;
  }
  /*getIntersectCode() {
    return `
   vec2 ${this.intersectStr} = intersectCube(origin, ray, ${this.minStr}, ${this.maxStr});
  `;
  }
  getShadowTestCode() {
    return `
      ${this.getIntersectCode()}
      if(${this.intersectStr}.x > 0.0 && ${this.intersectStr}.x < 1.0 && ${this.intersectStr}.x <= ${this.intersectStr}.y) return 0.0;
    `;
  }
  getMinimumIntersectCode() {
    return `
     if(${this.intersectStr}.x > 0.0 && ${this.intersectStr}.x <= ${this.intersectStr}.y && ${this.intersectStr}.x < t) {
       t = ${this.intersectStr}.x;
     }${this.material.type == 3 ? `if (${this.intersectStr}.y > 0.0 && ${this.intersectStr}.x <= ${this.intersectStr}.y && ${this.intersectStr}.y < t) {
       t = ${this.intersectStr}.y;
     }` : ''}`;
  }
  getNormalCalculationCode() {
    return `
    // have to compare intersectStr.x < intersectStr.y otherwise two coplanar
    // cubes will look wrong (one cube will "steal" the hit from the other)
    else if(t == ${this.intersectStr}.x && ${this.intersectStr}.x < ${this.intersectStr}.y) {
      normalForCube${this.normaltype}(normal, uv, hit, ${this.minStr}, ${this.maxStr});
      inside = false;
      ${this.material.getNormals()}
    }
    ${this.material.type == 3 ? `else if(t == ${this.intersectStr}.y && ${this.intersectStr}.x < ${this.intersectStr}.y) {
      normalForCube${this.normaltype}(normal, uv, hit, ${this.minStr}, ${this.maxStr});
      inside = true;
      ${this.material.getNormals()}
    }` : ''}`;
  }
  getHitCheck(scene) {
    return `
    // have to compare intersectStr.x < intersectStr.y otherwise two coplanar
    // cubes will look wrong (one cube will "steal" the hit from the other)
    else if (t == ${this.intersectStr}.x && ${this.intersectStr}.x < ${this.intersectStr}.y) {
      normalForCube${this.normaltype}(normal, uv, hit, ${this.minStr}, ${this.maxStr});
      inside = false;
      ${this.material.getCode(scene)}
    }
    ${this.material.type == 3 ? `else if (t == ${this.intersectStr}.y && ${this.intersectStr}.x < ${this.intersectStr}.y) {
      normalForCube${this.normaltype}(normal, uv, hit, ${this.minStr}, ${this.maxStr});
      inside = true;
      ${this.material.getCode(scene)}
    }` : ''}`;
  }*/
  setUniforms2(renderer) {
    //renderer.uniforms[this.minStr] = this.getMinCorner();
    //renderer.uniforms[this.maxStr] = this.getMaxCorner();
  }
  /*getMinCorner() {
    return this.minCorner.add(this.temporaryTranslation);
  }
  getMaxCorner() {
    return this.maxCorner.add(this.temporaryTranslation);
  }
  translate(translation) {
    this.minCorner = this.minCorner.add(translation);
    this.maxCorner = this.maxCorner.add(translation);
  }
  intersect(origin, ray) {
    return Cube.intersect(origin, ray, this.getMinCorner(), this.getMaxCorner());
  }*/
}
Cube.intersect = function (origin, ray, cubeMin, cubeMax) {
  var tMin = cubeMin.subtract(origin).divide(ray);
  var tMax = cubeMax.subtract(origin).divide(ray);
  var t1 = Vector.min(tMin, tMax);
  var t2 = Vector.max(tMin, tMax);
  var tNear = t1.maxComponent();
  var tFar = t2.minComponent();
  if (tNear > 0 && tNear < tFar) {
    return tNear;
  }
  return Number.MAX_VALUE;
};

class Model {
  constructor(url,onload) {
    this.url = url;
    this.buffers = {
      positions:new TextureBuffer('vec3',[]),
      uvs:new TextureBuffer('vec2',[]),
      normals:new TextureBuffer('vec3',[]),
      triangles:new TextureBuffer('index',[],3),
      triangleuvs:new TextureBuffer('index',[],3),
      trianglenormals:new TextureBuffer('index',[],3),
      nodes:new TextureBuffer('index',[],3),
      nodebounds:new TextureBuffer('vec3',[],3),
      //colors
    };
    var self = this;
    this.data = loadModel(this.url,()=>{
      for (var i in self.buffers) {
        if (!self.data[i]) continue;
        self.buffers[i].fillData(self.data[i]);
      }
      self.bvhreset = true;
      if (onload) onload(self);
    });
    this.bvhreset = true;
    this.objectTransformation = new Transform();
  }
  calculateSphericalUVs() {
    var m = this.data;
    var b = this.buffers;
    m.uvs = [];
    for (var i = 0; i < m.positions.length; i+=3) {
      var pos = m.positions.slice(i,i+3);
      var r = Math.sqrt(pos[0]*pos[0] + pos[1]*pos[1] + pos[2]*pos[2]);
      m.uvs.push(0.5 + Math.atan(pos[2] / r, pos[0] / r) / Math.PI / 2, 0.5 - Math.asin(pos[1] / r) / Math.PI);
    }
    b.uvs.fillData(m.uvs);
    m.triangleuvs = JSON.parse(JSON.stringify(m.triangles));
    b.triangleuvs.copyData(b.triangles);
    //console.log(13,m);
  }
  calculateVertexNormals(nointerp) {
    var m = this.data;
    var b = this.buffers;
    //m.trianglenormals = new Array(m.triangles.length).fill(0);
    m.normals = [];
    var facenormals = [];
    for (var i = 0; i < m.triangles.length; i+=3) {
      var tri = m.triangles.slice(i,i+3);
      var pos = tri.map(j=>new Vector(m.positions.slice(j*3,j*3+3)));
      var v0v1 = pos[0].subtract(pos[1]);
      var v0v2 = pos[0].subtract(pos[2]);
      facenormals.push(v0v1.cross(v0v2).normalize());
    }
    if (nointerp) {
      m.normals = facenormals.map(v=>v).flat();
      b.normals.fillData(m.normals);
      m.trianglenormals = new Array(m.triangles.length).fill(0).map((_,i)=>Math.floor(i/3));
      this.bvhreset = true;
    } else {
      for (var i = 0; i < m.positions.length/3; i++) {
        var tnormal = new Vector([0,0,0]);
        //var indices = [];
        for (var j = 0; j < m.triangles.length; j++) {
          if (m.triangles[j] == i) {
            tnormal = tnormal.add(facenormals[Math.floor(j/3)]);
            //indices.push(j);
          }
        }
        tnormal = tnormal.normalize();
        //var k = m.normals.length/3;
        m.normals.push(...tnormal);
        //for (var j = 0; j < indices.length; j++) {
        //  m.trianglenormals[indices[j]] = k;
        //}
      }
      b.normals.fillData(m.normals);
      m.trianglenormals = JSON.parse(JSON.stringify(m.triangles));
      b.trianglenormals.copyData(b.triangles);
    }
  }
  recenter(keepcenter) {
    var p = this.data.positions;
    var mins = this.getMin();
    var maxes = this.getMax();
    var center = mins.map((v,i)=>(v+maxes[i])/2);
    /*var center = [0,0,0];
    for (var i = 0; i < p.length; i+=3) {
      for (var j = 0; j < 3; j++) {
        center[j] += p[i+j]/p.length;
      }
    }*/
    for (var i = 0; i < p.length; i+=3) {
      for (var j = 0; j < 3; j++) {
        p[i+j] -= center[j];
      }
    }
    if (keepcenter) this.objectTransformation.translate(center);
    this.bvhreset = true;
  }
  renormalize(keepcenter,keepscale) {
    this.recenter(keepcenter);
    var size = 0;
    var p = this.data.positions;
    for (var i = 0; i < p.length; i+=3) {
      var d = p[i]*p[i]+p[i+1]*p[i+1]+p[i+2]*p[i+2];
      size = Math.max(size,d);
    }
    var scalar = 127/Math.sqrt(size);
    for (var i = 0; i < p.length; i++) {
      p[i] *= scalar;
    }
    if (keepscale) this.objectTransformation.scale(Math.sqrt(size)/127);
    else this.objectTransformation.scale(1/127);
    this.bvhreset = true;
  }
  generateBVH() {
    if (!this.bvhreset) return;
    var m = this.data;
    var b = this.buffers;
    //alert(JSON.stringify(m));
    var max_depth = Math.log2(m.positions.length/3);
    var trianglecentroids = [];
    for (var i = 0; i < m.triangles.length; i+=3) {
      var tri = m.triangles.slice(i,i+3);
      var pos = tri.map(j=>m.positions.slice(j*3,j*3+3));
      var center = pos.reduce((a,p) => a.map((v,k) => v+p[k]/3), [0,0,0]);
      trianglecentroids.push(center);
    }
    function subdivide(indices,depth,parentCost) {
      var mins = [Infinity,Infinity,Infinity];
      var maxes = [-Infinity,-Infinity,-Infinity];
      for (var i = 0; i < indices.length; i++) {
        for (var j = 0; j < 3; j++) {
          for (var k = 0; k < 3; k++) {
            var pos = m.positions[m.triangles[indices[i]*3+j]*3+k];
            mins[k] = Math.min(mins[k],pos);
            maxes[k] = Math.max(maxes[k],pos);
          }
        }
      }
      if (depth < max_depth && indices.length > 2) {
        var list1 = [];
        var list2 = [];
        /* Longest Axis
        var k = 0;
        var largest = 0;
        for (var i = 0; i < 3; i++) {
          if (maxes[i]-mins[i] > largest) {
            k = i;
            largest = maxes[i]-mins[i];
          }
        }
        var t = mins[k]+(largest)/2;
        var bestCost = 0;
        if (true) {
        /*/// determine split axis using SAH
        function aabb() {
          var obj = {};
          obj.mins = [Infinity,Infinity,Infinity];
          obj.maxes = [-Infinity,-Infinity,-Infinity];
          obj.addTriangle = function(index) {
            for (var j = 0; j < 3; j++) {
              var v = m.triangles[index*3+j];
              for (var l = 0; l < 3; l++) {
                var pos = m.positions[v*3+l];
                obj.mins[l] = Math.min(obj.mins[l],pos);
                obj.maxes[l] = Math.max(obj.maxes[l],pos);
              }
            }
          };
          obj.size = function() {
            return obj.maxes.map((v,i)=>v-obj.mins[i]);
          }
          obj.area = function() {
            var size = obj.size();
            return size[0]*size[1] + size[1]*size[2] + size[0]*size[2];
          }
          return obj;
        }
        function EvaluateSAH(indices, k, t) {
          var rightbox = aabb();
          var leftbox = aabb();
          var leftCount = 0;
          var rightCount = 0;
          for (var i = 0; i < indices.length; i++ ) {
            var index = indices[i];
            var center = trianglecentroids[index][k];
            if (center > t) {
              leftCount++;
              leftbox.addTriangle(index);
            } else {
              rightCount++;
              rightbox.addTriangle(index);
            }
          }
          var cost = leftCount * leftbox.area() + rightCount * rightbox.area();
          return cost > 0 ? cost : Infinity;
        }
        var t = 0;
        var k = 0;
        var bestCost = Infinity;
        var MAX = 20;
        if (indices.length > MAX*MAX) {
          for (var axis = 0; axis < 3; axis++) {
            var scale = (maxes[axis]-mins[axis])/MAX;
            for (var i = 1; i < MAX; i++) {
              var tsplit = mins[axis] + i * scale;
              var cost = EvaluateSAH(indices, axis, tsplit);
              if (cost < bestCost) {
                t = tsplit;
                k = axis;
                bestCost = cost;
              }
            }
          }
        } else {
          for (var axis = 0; axis < 3; axis++) {
          for (var i = 0; i < indices.length; i++) {
            var tsplit = trianglecentroids[indices[i]][axis];
            var cost = EvaluateSAH(indices, axis, tsplit);
            if (cost < bestCost) {
              t = tsplit;
              k = axis;
              bestCost = cost;
            }
          }
        }
        }
        if (bestCost < parentCost) {
        //*/
          for (var i = 0; i < indices.length; i++) {
            var index = indices[i];
            var center = trianglecentroids[index][k];
            if (center > t) {
              list1.push(index);
            } else {
              list2.push(index);
            }
          }
          if (list1.length > 0 && list2.length > 0) {
            return {
              min:mins,
              max:maxes,
              split:[k,t,0],
              child1:subdivide(list1,depth+1,bestCost),
              child2:subdivide(list2,depth+1,bestCost),
            };
          }
        }
      }
      return {
        min:mins,
        max:maxes,
        split:[0,0,0],
        indices:indices
      };
    }
    var bvh = subdivide(new Array(m.triangles.length/3).fill(0).map((_,i)=>i),0,Infinity);
    //console.log(bvh);
    var triangles = [];
    var triangleuvs = [];
    var trianglenormals = [];
    var nodes = [];
    var nodebounds = [];
    var largest = 0;
    var nodelength = 0;
    //bvh = bvh.child1.child1.child1;
    //bvh = bvh.child2;
    //console.log(bvh);
    function collapse(node,parentindex) {
      nodebounds.push([node.min,node.max,node.split]);
      var index = nodes.length;
      nodes.push([0,0,0]);
      if (node.indices) {
        largest = Math.max(largest,node.indices.length);
        nodes[index][0] = node.indices.length;
        nodes[index][1] = parentindex;
        nodes[index][2] = triangles.length/3;
        node.indices.forEach(i=>{
          triangles.push(...m.triangles.slice(i*3,i*3+3));
          triangleuvs.push(...m.triangleuvs.slice(i*3,i*3+3));
          trianglenormals.push(...m.trianglenormals.slice(i*3,i*3+3));
        });
        nodelength++;
      } else {
        nodes[index][1] = parentindex;
        collapse(node.child1,index);
        nodes[index][2] = collapse(node.child2,index);
        nodelength+=2;
      }
      return index;
    }
    collapse(bvh,0);
    //console.log(nodes[3988]);
    //if (nodes[3988]) nodes[3988][1] = 3988;
    //console.log(nodebounds[3988]);
    //largest = b.triangles.length;
    //b.nodes.fillData([0,b.triangles.length/3,0,0]);
    //b.nodebounds.fillData(nodebounds[0].flat());
    //console.log(nodes,nodebounds,triangles);
    for (var i in b) {
      if (!m[i]) continue;
      b[i].fillData(m[i]);
    }
    b.nodes.fillData(nodes.flat());
    b.nodebounds.fillData(nodebounds.flat().flat());
    //console.log(m);
    //console.log(nodes,nodebounds,triangles,triangleuvs,trianglenormals);
    b.triangles.fillData(triangles);
    b.triangleuvs.fillData(triangleuvs);
    b.trianglenormals.fillData(trianglenormals);
    this.nodelength = Math.min(nodelength,Math.max(Math.floor(max_depth*16),0)); // todo: calculate max backsteps
    this.largestleaf = largest+1;
    this.bvhreset = false;
  }
  getMin(poslist) {
    poslist = poslist ? poslist.map(v=>this.data.positions.slice(v*3,v*3+3)).flat() : this.data.positions;
    var mins = [Infinity,Infinity,Infinity];
    for (var i = 0; i < 3; i++) {
      for (var j = i; j < poslist.length; j+=3) {
        mins[i] = Math.min(mins[i],poslist[j]);
      }
    }
    return mins;
  }
  getMax(poslist) {
    poslist = poslist ?poslist.map(v=>this.data.positions.slice(v*3,v*3+3)).flat() : this.data.positions;
    var maxes = [-Infinity,-Infinity,-Infinity];
    for (var i = 0; i < 3; i++) {
      for (var j = i; j < poslist.length; j+=3) {
        maxes[i] = Math.max(maxes[i],poslist[j]);
      }
    }
    return maxes;
  }
  bakeTransform(transform) {
    //console.log(this.model);
    var m = this.data;
    for (var i = 0; i < m.positions.length; i+=3) {
      var v = m.positions.slice(i,i+3);
      v = transformVector(v,1,transform);
      m.positions.splice(i,3,...v);
    }
    var normaltransform = transform.inverse().transpose();
    for (var i = 0; i < m.normals.length; i+=3) {
      var v = m.normals.slice(i,i+3);
      v = transformVector(v,0,normaltransform);
      m.normals.splice(i,3,...v);
    }
    this.bvhreset = true;
    //console.log(this.model);
  }
}

//var XXX = Math.floor(1592*Math.random());
class ModelObject extends TracerObject {
  constructor(id, model, material) {
    super(id,material);
    this.model = model;
    this.objectTransformation = model.objectTransformation;
    this.culling = true;
    this.smoothing = false;
    this.type = "Model";
    /*this.functionStr = 'intersectModel' + id;
    this.intersectStr = 'tModel' + id;
    this.uvStr = 'tModelUv' + id;
    this.normalStr = 'tModelNormal' + id;
    this.insideStr = 'tModelInside' + id;*/
  }
  get functionStr() {return 'intersectModel' + this.id;}
  getGlobalCode2(scene) {
    var m = this.model.data;
    var b = this.model.buffers;
    var self = this;
    var culling = (self.material.type == 3 || self.material.type == 5) ? 'inside, ' : '';
    if (!this.culling) culling = 'inside, ';
    var intersectTri = 
      `intersectTriangle(origin, ray, t, uv, normal, ${
      culling+
      [0,1,2].map(v=>
        b.positions
          .sample(b.triangles
            .sample('k',v))
      ).join(', ') +
      (b.uvs.datalength > 0 ? 
      [0,1,2].map(v=>
        ', '+b.uvs
          .sample(b.triangleuvs
            .sample('k',v))
      ).join('') : '') +
      (self.smoothing && b.normals.datalength > 0 ? 
      [0,1,2].map(v=>
        ', '+b.normals
          .sample(b.trianglenormals
            .sample('k',v))
      ).join('') : '')});`;
    /*
    var str = `
float ${self.functionStr}(vec3 origin, vec3 ray, inout vec2 uv, inout vec3 normal, inout bool inside, inout vec3 colorMask) {
  float t = INFINITY;
  float Infinity = INFINITY;  
  //if (${b.triangles.sample(XXX)} == ${m.triangles[XXX]}) colorMask*=1.5;
  if (length(${b.positions.sample(XXX)}-${toVec(3,m.positions.slice(XXX*3,XXX*3+3))}) < 0.001) colorMask*=1.5;
  //if (${b.triangles.sample('34*3')} == 11) colorMask*=0.5;
  if (intersectBox(origin, ray, ${b.nodebounds.sample('0')}, ${b.nodebounds.sample('1')})) {
    colorMask *= 0.95;
    for (int k = 0*3; k < ${
    500*3+3
    //b.triangles.length
    }; k+=3) {
      ${
    intersectTri
    }
    }
  }

  if (t >= INFINITY) return -1.;
  return t;
}
`;
    /*/
    var d = scene.debug == "colorMask" ? "" : "//";
    var ordered = true;
    var o = ordered ? "" : "//";
    var n = ordered ? "//" : "";
    var str = `
float ${self.functionStr}(vec3 origin, vec3 ray, inout vec2 uv, inout vec3 normal, inout bool inside, inout vec3 colorMask) {
  float t = INFINITY;
  float Infinity = INFINITY;
  vec3 invray = 1./ray;
  int nodeindex = 0;
  int state = 0; // 0=FromParent; 1=FromSibling; 2=FromChild;
  ${d} float boxcounter = 0.;
  ${d} float trianglecounter = 0.;
  for (int i = 0; i < ${self.model.nodelength}; i++) {
    int trianglelength = ${b.nodes.sample('nodeindex',0)};
    int parent = ${b.nodes.sample('nodeindex',1)};
    if (state == 2) { // state == FromChild
      if (nodeindex == 0) break;
      int child1 = parent+1;
      int child2 = ${b.nodes.sample('parent',2)};
      ${o}bool side = checkSplit(origin, ${b.nodebounds.sample('parent',2)});
      ${o}int nearchild = side ? child2 : child1;
      ${o}int farchild = side ? child1 : child2;
      ${o}if (nodeindex == nearchild) {
      ${n}if (nodeindex == child2) {
        ${o}nodeindex = farchild;
        ${n}nodeindex = child1;
        state = 1; // state = FromSibling
      } else {
        nodeindex = parent;
        state = 2; // state = FromChild
      }
      continue;
    }
    ${d} boxcounter += 1.;
    if (intersectBox(origin, invray, ${b.nodebounds.sample('nodeindex',0)}, ${b.nodebounds.sample('nodeindex',1)}, t)) {
      //colorMask *= 0.95;
      if (trianglelength <= 0) { // !isLeaf()
        ${o}int child1 = nodeindex+1;
        int child2 = ${b.nodes.sample('nodeindex',2)};
        ${o}bool side = checkSplit(origin, ${b.nodebounds.sample('nodeindex',2)});
        state = 0; // state = FromParent
        ${o}nodeindex = side ? child2 : child1; // nearchild
        ${n}nodeindex = child2;
        continue;
      }
      int trianglestart = ${b.nodes.sample('nodeindex',2)};
      for (int j = 0; j < ${self.model.largestleaf}; j++) {
        ${d} trianglecounter += 1.;
        if (j > trianglelength) break;
        int k = trianglestart+j;
        ${intersectTri}
      }
      //if (t < INFINITY) return t;
    }
    if (state == 0) { // FromParent
      int child1 = parent+1;
      ${o}int child2 = ${b.nodes.sample('parent',2)};
      ${o}bool side = checkSplit(origin, ${b.nodebounds.sample('parent',2)});
      ${o}nodeindex = side ? child1 : child2; // i = farchild
      ${n}nodeindex = child1;
      state = 1; // state = FromSibling
    } else if (state == 1) { // FromSibling
      nodeindex = parent; // i = parent
      state = 2; // state = FromChild
    }
  }
  ${d} if (intersectBox(origin, invray, ${b.nodebounds.sample('0',0)}, ${b.nodebounds.sample('0',1)})) {
    ${d} colorMask *= vec3(boxcounter/50.,trianglecounter/50.,0.);
  ${d} }
  if (t >= INFINITY) return -1.;
  return t;
}
`;
    //*/
    //console.log(str);
    //alert(str);
    return str;
  }
  /*getIntersectCode() {
    return `
   vec2 ${this.uvStr} = vec2(0);
   vec3 ${this.normalStr} = vec3(1);
   bool ${this.insideStr} = false;
   float ${this.intersectStr} = ${this.functionStr}(origin, ray/lray, ${this.uvStr}, ${this.normalStr}, ${this.insideStr}, colorMask) / lray;
  `;
  }*/
  getObjectIntersect(origin,ray) {
    return `
      ${this.intersectStr} = ${this.functionStr}(${origin}, ${ray}, ${this.uvStr}, ${this.normal2Str}, ${this.insideStr}, colorMask);`;
  }
  applyNormals(hit,ray) {
    return ``;
  }
  setUniforms2(renderer) {
    //renderer.uniforms[this.minStr] = this.getMinCorner();
  }
  getMinCorner2(poslist) {
    return new Vector(this.model.getMin());
  }
  getMaxCorner2(poslist) {
    return new Vector(this.model.getMax());
  }
  /*translate(translation) {
    for (var i = 0; i < 3; i++) {
      for (var j = i; j < this.model.positions.length; j+=3) {
        this.model.positions[j] += translation[i];
      }
    }
  }
  intersect(origin, ray) {
    return Cube.intersect(origin, ray, this.getMinCorner(), this.getMaxCorner());
  }*/
}

class VoxelData {
  constructor(url,onload) {
    this.texture = WuglInst.create3DTexture(1,1,1);
    this.data = [];
    this.size = [24,20,24];
    for (var x = 0; x < this.size[0]; x++) {
      this.data.push([]);
      for (var y = 0; y < this.size[1]; y++) {
        this.data[x].push([]);
        for (var z = 0; z < this.size[2]; z++) {
          var list = [
            {x:8,y:8,z:8,sx:8,sy:8,sz:8},
            {x:16,y:8,z:16,sx:8,sy:8,sz:8},
            {x:12,y:12,z:12,sx:8,sy:8,sz:8},
            {x:14,y:8,z:10,sx:8,sy:8,sz:8},
          ];
          var v = 0;
          for (var i = 0; i < list.length; i++) {
            var n = list[i];
            var d = (x-n.x)*(x-n.x) / n.sx / n.sx + 
              (y-n.y)*(y-n.y) / n.sy / n.sy + 
              (z-n.z)*(z-n.z) / n.sz / n.sz;
            v += Math.max(1-Math.sqrt(d)+Math.random()/4,0);
          }
          this.data[x][y].push(v);
        }
      }
    }
    this.id = 0;
    this.filtering = gl.NEAREST;
    //this.filtering = gl.LINEAR;
    this.fillData(null,1,1,1);
  }
  get filtering() {
    return this.texture.options.filter;
  }
  set filtering(v) {
    this.texture.options.filter = v;
  }
  get texStr() {return 'voxBuf'+this.id;}
  get sampleStr() {return 'sampleVoxBuf'+this.id;}
  fillData() {
    this.width = this.size[0];
    this.height = this.size[1];
    this.depth = this.size[2];
    var pixels = this.data.flat().flat().map(v=>[Math.round(Math.max(v,0)*255),Math.round(Math.max(-v,0)*255),0,255]).flat();
    //console.log(ui,this.width,this.height,pixels)
    var pixeldata = new Uint8Array(pixels);
    //console.log(data);
    this.texture.fillData(pixeldata, this.width, this.height, this.depth);
  }
  getGlobalCode() {
    if (this.filtering == gl.NEAREST) {
      return `
        uniform sampler3D ${this.texStr};
        float ${this.sampleStr}(vec3 pos) {
          vec4 samp = texelFetch3D(${this.texStr},ivec3(pos),0);
          return samp.x - samp.y;
        }`;
    } else if (this.filtering == gl.LINEAR) {
      return `
        uniform sampler3D ${this.texStr};
        float ${this.sampleStr}(vec3 pos) {
          vec3 size = vec3(textureSize3D(${this.texStr},0));
          vec4 samp = texture3D(${this.texStr},pos/size);
          return samp.x - samp.y;
        }`;
    }
  }
  sample(pos) {
    return `${this.sampleStr}(${pos})`;
  }
}

class ProceduralVoxelData {
  constructor(code,globalCode) {
    this.id = 0;
    this.code = code||`0.5`;
    this.size = [1,1,1];
    this.globalCode = globalCode||``;
  }
  sample(pos) {
    return `(${this.code.replaceAll('pos',`(${pos})`)})`;
  }
  getGlobalCode() {
    return this.globalCode;
  }
}

Math.clamp = function(value, min, max) {
  return this.min(this.max(value, min), max);
}; 
class TerrainData {
  constructor() {
    this.tileSize = 1;
    this.mips = 1;
    this.height = new Texture();
    this.elevation = new Texture();
    this.color = new Texture();
    this.normal = new Texture();
  }
  async loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load ' + url));
      img.src = url;
    });
  }
  async stitchImages(lat,lon,zoom,detail,callback) {
    const imageSize = 256*2**detail;
    const canvasSize = "256px";
    const paddingSize = Math.ceil(2**detail/2);
		const largeSize = 1+2*paddingSize;
    
    zoom += detail;

    const canvas = document.createElement('canvas');
    canvas.width = imageSize;
    canvas.height = imageSize;
    const ctx = canvas.getContext('2d');

    // Get global pixel XY
    const { x: pixelX, y: pixelY } = this.latLonToPixelXY(lat, lon, zoom);

    // Calculate center tile x,y
    const tileX = Math.floor(pixelX / 256);
    const tileY = Math.floor(pixelY / 256);

    // Calculate pixel offset inside tile
    const offsetX = pixelX % 256;
    const offsetY = pixelY % 256;

    // Prepare big canvases for stitching tiles
    const bigCanvas = document.createElement('canvas');
    bigCanvas.width = 256 * largeSize;
    bigCanvas.height = 256 * largeSize;
    const bigCtx = bigCanvas.getContext('2d');

    // Load grid of tiles
    const tilePromises = [];

    for (let dy = -paddingSize; dy <= paddingSize; dy++) {
      for (let dx = -paddingSize; dx <= paddingSize; dx++) {
        const tx = tileX + dx;
        const ty = tileY + dy;

        // tile URL
        const url = callback(tx,ty,zoom);

        tilePromises.push(this.loadImage(url).catch(function(e) {
          console.warn(`Failed to load tile ${tx},${ty},${zoom}`);
          // Return blank 256x256 image on fail
          const emptyCanvas = document.createElement('canvas');
          emptyCanvas.width = 256;
          emptyCanvas.height = 256;
          return emptyCanvas;
        }));
      }
    }

    try {
      const tiles = await Promise.all(tilePromises);

      // Draw elevation and imagery tiles into big canvases
      for (let i = 0; i < tiles.length; i++) {
        const dx = i % largeSize;
        const dy = Math.floor(i / largeSize);
        bigCtx.drawImage(tiles[i], dx * 256, dy * 256);
      }

      // Now crop 256x256 from big canvas centered on offset + 256 (center tile offset + 1 tile left/up)
      const cropX = Math.floor(offsetX + 256 * paddingSize - imageSize/2); // center crop box half-width
      const cropY = Math.floor(offsetY + 256 * paddingSize - imageSize/2);

      // Crop and draw final imagery to visible canvas
      ctx.clearRect(0, 0, imageSize, imageSize);
      ctx.drawImage(bigCanvas, cropX, cropY, imageSize, imageSize, 0, 0, imageSize, imageSize);
			
      return { canvas, ctx };
    } catch (err) {
      alert("Error fetching tiles: " + err.message);
    }
  }
  async generateLevel(lat,lon,zoom,elev_detail,map_detail) {
    try {
      var stitches = await Promise.all([
        this.stitchImages(lat,lon,zoom,elev_detail,(tx,ty,zoom)=>`https://elevation-tiles-prod.s3.amazonaws.com/terrarium/${zoom}/${tx}/${ty}.png`),
        this.stitchImages(lat,lon,zoom,map_detail,(tx,ty,zoom)=>`https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/${zoom}/${ty}/${tx}.jpg`),
        //this.stitchImages(lat,lon,zoom,map_detail,(tx,ty,zoom)=>`https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${zoom}/${ty}/${tx}`),
      ]);

      const { canvas: elev_canvas, ctx: elev_ctx } = stitches[0];
      const { canvas: map_canvas, ctx: map_ctx } = stitches[1];
      
      const imageSize = elev_canvas.width;

      // Decode elevation for heightmap generation
      const imgData = elev_ctx.getImageData(0, 0, imageSize, imageSize);
      const heightData = imgData.data;
      
      const meters = this.metersPerTile(lat, zoom);

      // Generate grayscale heightmap for download and visualization
      const grayImageData = map_ctx.createImageData(imageSize, imageSize);
      const normImageData = map_ctx.createImageData(imageSize, imageSize);
      var elevations = [];
      var min_elev = Infinity, max_elev = -Infinity; 
      for (let i = 0; i < heightData.length; i += 4) {
        const r = heightData[i], g = heightData[i + 1], b = heightData[i + 2];
        const elevation = this.decodeTerrarium(r, g, b);
        min_elev = Math.min(min_elev,elevation);
        max_elev = Math.max(max_elev,elevation);
        elevations.push(elevation);
      }
      for (let i = 0; i < elevations.length; i++) {
        var norm_elev = (elevations[i] - min_elev) / (max_elev - min_elev);
        const shade = Math.max(0, Math.min(255, Math.round(norm_elev * 255)));
        grayImageData.data[i * 4] = shade;
        grayImageData.data[i * 4 + 1] = shade;
        grayImageData.data[i * 4 + 2] = shade;
        grayImageData.data[i * 4 + 3] = 255;
        
        // Calculate height differences (central difference)
        var sx = 2, sy = 2;
        var cL = i % imageSize == 0, cR = i % imageSize == 255;
        var cD = i-imageSize < 0, cU = i+imageSize >= imageSize*imageSize;
        var heightL = cL?elevations[i]:elevations[i-1];
        var heightR = cR?elevations[i]:elevations[i+1];
        var heightD = cD?elevations[i]:elevations[i-imageSize];
        var heightU = cU?elevations[i]:elevations[i+imageSize];
        if (cL || cR) sx = 1;
        if (cD || cU) sy = 1;
        
        // Assume pixel spacing is 1, scale if needed
        const dx = (heightR - heightL) / sx;
        const dy = (heightU - heightD) / sy;
        
        // Normal vector
        let nx = -dx;
        let ny = dy;
        let nz = meters / 256;
        
        // Normalize
        const length = Math.sqrt(nx * nx + ny * ny + nz * nz);
        nx /= length;
        ny /= length;
        nz /= length;
        
        // Map from [-1, 1] to [0, 255]
        normImageData.data[i * 4] = Math.round((nx + 1) / 2 * 255);
        normImageData.data[i * 4 + 1] = Math.round((ny + 1) / 2 * 255);
        normImageData.data[i * 4 + 2] = Math.round((nz + 1) / 2 * 255);
        normImageData.data[i * 4 + 3] = 255; // full opacity
      }
      
      // Crop and draw height data to visible gray_canvas
      var gray_canvas = document.createElement("canvas");
      var gray_ctx = gray_canvas.getContext("2d");
      gray_canvas.width = imageSize;
      gray_canvas.height = imageSize;
      gray_ctx.clearRect(0, 0, imageSize, imageSize);
      gray_ctx.putImageData(grayImageData, 0, 0);
      
      // Crop and draw normals to visible norm_canvas
      var norm_canvas = document.createElement("canvas");
      var norm_ctx = norm_canvas.getContext("2d");
      norm_canvas.width = imageSize;
      norm_canvas.height = imageSize;
      norm_ctx.clearRect(0, 0, imageSize, imageSize);
      norm_ctx.putImageData(normImageData, 0, 0);

      //window.cachedHeightmap = grayImageData;

      //const residualX = pixelX - Math.floor(pixelX);
      //const residualY = pixelY - Math.floor(pixelY);
      
      console.log("Loaded zoom level "+zoom);
      
      return {
        gray_canvas,
        elev_canvas,
        map_canvas,
        norm_canvas,
        tileSize: meters,
        heightRange: [min_elev,max_elev],
        centerElev: elevations[elevations.length/2],
        zoom
      };
    } catch (err) {
      alert("Error fetching tiles: " + err.message);
    }
  }
  stitchLevels(levels, name) {
    var canvas = document.createElement("canvas");
    var ctx = canvas.getContext("2d");
    var imageSize = levels[0][name].width;
    canvas.width = imageSize * levels.length;
    canvas.height = imageSize;
    for (var i = 0; i < levels.length; i++) {
      ctx.drawImage(levels[i][name], i * imageSize, 0, imageSize, imageSize);
    }
    return canvas;
  }
  assignTexture(name,canvas,options) {
    this[name].texture = WuglInst.createTexture(canvas.width,canvas.height,options);
    this[name].texture.fillData(canvas);
    this[name].width = canvas.width;
    this[name].height = canvas.height;
  }
  async generate(lat,lon,zoom=15,mips=8,map_detail=0,elev_detail=0) {
    var levels = await Promise.all(new Array(mips).fill(0).map((_,i)=>this.generateLevel(lat,lon,zoom-i,map_detail,elev_detail)));

    var gray_canvas = this.stitchLevels(levels, "gray_canvas");
    var elev_canvas = this.stitchLevels(levels, "elev_canvas");
    var map_canvas = this.stitchLevels(levels, "map_canvas");
    var norm_canvas = this.stitchLevels(levels, "norm_canvas");

    var gl = WuglInst.gl;
    this.assignTexture("height",gray_canvas,{filter:gl.LINEAR});
    this.assignTexture("elevation",elev_canvas,{filter:gl.NEAREST});
    this.assignTexture("color",map_canvas,{filter:gl.LINEAR});
    this.assignTexture("normal",norm_canvas,{filter:gl.LINEAR});
    this.tileSize = levels[0].tileSize;
    this.mips = levels.length;
    
    console.log("✔ Perfectly centered terrain data ready.");
		return {gray_canvas,elev_canvas,map_canvas,norm_canvas};
  }
  latLonToPixelXY(lat, lon, zoom) {
    lat = Math.clamp(lat, -85.0511, 85.0511);
    const latRad = lat * Math.PI / 180;
    const n = 2 ** zoom;
    const x = ((lon + 180) / 360) * n * 256;
    const y = (1 - (Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI)) / 2 * n * 256;
    return { x, y };
  }
  metersPerTile(lat, zoom) {
    const earthCircumference = 40075016.686; // in meters
    const n = Math.pow(2, zoom);
    return (earthCircumference * Math.cos(lat * Math.PI / 180)) / n;
  }
  decodeTerrarium(r, g, b) {
    return (r * 256 + g + b / 256) - 32768;
  }
}

class TerrainMap extends TracerObject {
  constructor(id,data,elevation=0,scalar=1,groundHeight=1) {
    var material = new Material(0);
    material.color = data.color;
    super(id,material);
    /*var self = this;
    material.color.filterCode = function(tex,uv,scene) {
      if (!scene.background.groundPlane) return tex(uv);
      return `(hit.y < ${toFloat(scene.background.groundHeight)} ? vec4(0.9294,0.7882,0.6863,1.) : ${tex(uv)})`;
    };*/
    this.type = "TerrainMap";
    this.data = data;
    this.norm_tex = data.normal;
    this.elev_tex = data.elevation;
    this.scalar = scalar;
    this.elevation = elevation;
  }
  get functionStr() {return 'intersectTerrainMap'+this.id;}
  get testFunctionStr() {return 'doesIntersectTerrainMap'+this.id;}
  get normalFunctionStr() {return 'calculateTerrainMapNormals'+this.id;}
  get heightFunctionStr() {return 'calculateTerrainMapHeight'+this.id;}
  get uvFunctionStr() {return 'calculateTerrainMapUV'+this.id;}
  getGlobalCode(scene) {
    var m = toFloat(this.scalar);
    var n = toFloat(this.data.mips);
    var ts = toFloat(this.data.tileSize/this.scalar);
    var d = scene.debug == "colorMask" ? "" : "//";
    return `
vec2 ${this.uvFunctionStr}(vec2 uv) {
  uv = uv / ${ts} * 4.;
  float sz = floor(max(log2(max(abs(uv.x),abs(uv.y))),0.));
  if (sz >= ${n}) return vec2(-1.);
  uv = uv / pow(2.,sz + 2.) + vec2(0.5);
  return vec2((uv.x+sz)/${n},uv.y);
}
float ${this.heightFunctionStr}(vec2 uv) {
  uv = ${this.uvFunctionStr}(uv);
  vec4 samp = ${this.elev_tex.texture2D('uv')};
  //samp = floor(samp*255.+vec4(0.5));
  //return ((samp.r-128.) * 256. + samp.g + samp.b / 256. - ${toFloat(this.elevation)})/${toFloat(this.scalar)};
  return ((samp.r - 0.5) * 65536. + samp.g * 256. + samp.b - ${toFloat(this.elevation)})/${toFloat(this.scalar)};
}
float ${this.functionStr}(vec3 ray, vec3 origin, float max_t, inout vec3 colorMask) {
  origin = origin / ${m};
  max_t = min(2000., max_t / ${m});

  // Always jump at least this far, massively speeding up glancing rays
  // This comes at the cost of resolving surface details, but we can hack this parameter with distance to reduce this
  const float PLANCK = 0.01;
  const float MIN_JUMP = PLANCK * 10.0;
  const float MIN_JUMP_FACTOR = 0.03;

  // Remember the surface we got closest to during march and use that *as* the surface
  float min_d = INFINITY;
  float min_t = 0.0;

  float t = PLANCK;
  for (int i = 0; i < 128; i++) {
    vec3 samp = origin + ray * t;
    float d = samp.y - ${this.heightFunctionStr}(samp.xz);

    ${d} colorMask *= 0.95;
    
    if (t > max_t) {
      return -1.;
    } else if (abs(d) < PLANCK * t * 0.1) {
      return t * ${m};
    } else if (d < min_d) {
      min_d = d;
      min_t = t;
    }
    
    t += d * (0.2 + t * MIN_JUMP_FACTOR + MIN_JUMP);
  }
  
  //if (min_d >= 20.) min_t = -1.;
  
  return min_t * ${m};
}
bool ${this.testFunctionStr}(vec3 ray, vec3 origin) {
  origin = origin / ${m};

  // Always jump at least this far, massively speeding up glancing rays
  // This comes at the cost of resolving surface details, but we can hack this parameter with distance to reduce this
  const float PLANCK = 0.02;
  const float MIN_JUMP = PLANCK * 10.0;
  const float MIN_JUMP_FACTOR = 0.06;

  float t = PLANCK;
  for (int i = 0; i < 64; i++) {
    vec3 samp = origin + ray * t;
    float d = samp.y - ${this.heightFunctionStr}(samp.xz);
    
    if (d < PLANCK * t * 0.1) {
      return true;
    } else if (t > 2000.0) {
      return false;
    }
    
    t += d * (0.25 + t * MIN_JUMP_FACTOR + MIN_JUMP);
  }
  
  return true;
}
void ${this.normalFunctionStr}(vec3 hit, inout vec3 normal, inout vec2 uv) {
  uv = ${this.uvFunctionStr}(hit.xz / ${m});
  normal = ${this.norm_tex.texture2D('uv')}.xzy*2.-vec3(1);
}
    `;
  }
  getNormalCalculationCode() {
    return `
       else if (t == ${this.intersectStr}) {
         ${this.normalFunctionStr}(hit,normal,uv);
         ${this.material.getNormals(this)}
       }`;
  }
  getHitCheck(scene) {
    return `
       else if (t == ${this.intersectStr}) {
         ${this.normalFunctionStr}(hit,normal,uv);
         ${this.material.getCode(scene,this)}
       }`;
  }
  getIntersectCode(scene) {
    return `
      float ${this.intersectStr} = ${this.functionStr}(ray/lray,origin,t,colorMask)/lray;`;
  }
  getShadowTestCode(scene) {
    return `
      if(${this.testFunctionStr}(ray/lray,origin)) return 0.0;`;
  }
  getMinimumIntersectCode() {
    return `
      if(${this.intersectStr} > 0.0 && ${this.intersectStr} < t) t = ${this.intersectStr};`;
  }
  setUniforms(renderer) {
    //renderer.uniforms[this.minStr] = this.getMinCorner();
  }
  getMinCorner(poslist) {
    return new Vector([0,0,0]);
  }
  getMaxCorner(poslist) {
    return new Vector([0,0,0]);
  }
}

class SignedDistanceField extends TracerObject {
  constructor(id, field, material) {
    super(id,material);
    this.field = field;
    this.type = "SDF";
  }
  get functionStr() {return 'intersectSDF' + this.id;}
  get normalFunctionStr() {return 'getNormalsSDF' + this.id;}
  getGlobalCode2(scene) {
    var d = scene.debug == "colorMask" ? "" : "//";
    var cullinginter = (self.material.type == 3 || self.material.type == 5) ? 'inside = sdf < 0.0;' : '';
    var cullingabs = (self.material.type == 3 || self.material.type == 5) ? 'abs(sdf)' : 'sdf';
    var str = `
  float ${this.functionStr}(vec3 origin, vec3 ray, inout bool inside, inout vec3 colorMask) {
    const float MAX_DISTANCE = 20.0; // Maximum distance to march
    const float PLANCK = 0.001; // Threshold

    float t = 0.;
    float dist;
    for (int i = 0; i < 32; i++) { // Maximum iterations
      ${d} colorMask *= 0.95;
      vec3 sample_pos = origin + t * ray;

      // Sample the SDF texture at the current position
      float sdf = ${this.field.sample('sample_pos')}; // Sample the signed distance from the texture
      dist = ${cullingabs} * 0.9;

      if (dist < PLANCK) { // If we are close enough to a surface
        ${cullinginter} // Determine if we are inside or outside
        return t; // Return the distance to the surface
      }

      t += dist; // March forward by the distance from the surface
      if (t >= MAX_DISTANCE) break; // Break if we exceed max distance
    }

    if (dist < 0.05) {
      ${cullinginter}
      return t;
    }

    return -1.0; // Return -1 if we didn't hit anything
  }
  void ${this.normalFunctionStr}(vec3 hit, inout vec2 uv,  inout vec3 normal) {
    vec2 eps = vec2(0.01, 0.0); // Small offset for normal calculation
    // Sample the SDF to calculate normals
    float dX = ${this.field.sample('hit + eps.xyy')} - ${this.field.sample('hit - eps.xyy')};
    float dY = ${this.field.sample('hit + eps.yxy')} - ${this.field.sample('hit - eps.yxy')};
    float dZ = ${this.field.sample('hit + eps.yyx')} - ${this.field.sample('hit - eps.yyx')};

    // Calculate the normal from the gradient of the SDF
    normal = normalize(vec3(dX, dY, dZ));
  }
  `;
      return str;
    }
  getObjectIntersect(origin,ray) {
      return `
        ${this.intersectStr} = ${this.functionStr}(${origin}, ${ray}, ${this.insideStr}, colorMask);`;
    }
  applyNormals(hit,ray) {
    return `
    ${this.normalFunctionStr}(${hit}, ${this.uvStr}, ${this.normal2Str});
    `;
  }
  setUniforms2(renderer) {
    //renderer.uniforms[this.minStr] = this.getMinCorner();
  }
  getMinCorner2(poslist) {
    return new Vector(this.field.size.map(v=>-1.5*v));
  }
  getMaxCorner2(poslist) {
    return new Vector(this.field.size.map(v=>1.5*v));
  }
  /*
  intersect(origin, ray) {
    return Cube.intersect(origin, ray, this.getMinCorner(), this.getMaxCorner());
  }*/
}

class VolumeMaterial extends Material {
  constructor() {
    super(0,[0,0,0]);
  }
  getCode(scene,obj) {
    var id = obj.id;
    return ``;
  }
}

class Volume extends TracerObject {
  constructor(id, voxel) {
    var material = new VolumeMaterial()
    super(id,material);
    this.voxel = voxel;
    this.type = "Volume";
    this.sigma_a = 0/voxel.size[0];
    this.sigma_s = 5/voxel.size[0];
    this.asymetryfactor = 0;
  }
  //get functionStr() {return 'intersectVolume' + this.id;}
  getGlobalCode2() {
    return '';
  }
  getNormalCalculationCode() {
    return '';
    /*return `
       else if (t == ${this.intersectStr}) {
         normal = vec3(0.5);
       }`;*/
  }
  getHitCheck(scene) {
    return '';
  }
  getHitCheckVol(scene) {
    var id = this.id;
    var self = this;
    return `
      vec3 VsceneHit = (vec4(hit,1.) * ${this.transformInvStr}).xyz;
      float VsceneT = distance(Vorigin, VsceneHit);
      if (${this.intersectStr} < VsceneT) {
        vec3 Vhit = Vorigin+Vray*${this.intersectStr};

        const float step_size = 1.;
        const float sigma_a = ${toFloat(this.sigma_a)}; // absorption coefficient
        const float sigma_s = ${toFloat(this.sigma_s)}; // scattering coefficient
        const float sigma_t = sigma_a + sigma_s; // extinction coefficient
        const float g = ${toFloat(this.asymetryfactor)}; // henyey-greenstein asymetry factor

        ${scene.lights.map(v=>v.prepScattering(self,scene)).join('')}

        vec2 tval = intersectVolume2(Vhit, Vray, ${toVec(3,this.getMin())}, ${toVec(3,this.getMax())});

        float dist = min(tval.y - tval.x, VsceneT - ${this.intersectStr});

        //colorMask *= vec3(dist/8.,1,1);
        
        //*
        float rand2 = random(vec3(151.7242, 14.098, 92.3421), timeSinceStart);  
        int ns = int((dist + rand2) / step_size)+1;
        float stride = dist / float(ns);
        for (int i = 0; i < 100; i++) {
          if (i >= ns) break;
        /*/
        float stride = (tval.y - tval.x) / 50.;
        for (int i = 0; i < 50; i++) {
        //*/
          float rand = random(vec3(151.7242, 14.098, 92.3421), timeSinceStart + float(i)/10.);  
          float tsamp = tval.x + stride * (float(i) + rand);
          vec3 sample_pos = Vhit + tsamp * Vray;

          float density = ${this.voxel.sample('sample_pos')};
          float sample_attenuation = exp(-step_size * density * sigma_t);
          colorMask *= sample_attenuation;

          if (density < EPSILON) continue;
          ${scene.lights.map(v=>v.scattering(self,scene)).join('')}
        }
        
        //origin = (vec4(Vorigin + Vray * (tval.y + EPSILON),1.) * ${this.transformStr}).xyz;
      }`;
  }
  getIntersectCode(scene) {
    return '';
  }
  getIntersectCodeVol(scene,code) {
    var id = this.id;
    var d = scene?.debug == "colorMask" ? "" : "//";
    return `
      float ${this.intersectStr} = -1.;
      if (intersectBox(origin, 1./ray, ${this.minStr}, ${this.maxStr}, t)) {
        vec3 Vorigin = (vec4(origin,1.) * ${this.transformInvStr}).xyz;
        vec3 Vray = normalize((vec4(ray/lray,0.) * ${this.transformInvStr}).xyz);
        ${this.intersectStr} = intersectVolume(Vorigin, Vray, ${toVec(3,this.getMin())}, ${toVec(3,this.getMax())});
        if (${this.intersectStr} >= 0.) {
          ${d} colorMask *= 0.95;
          ${code}
        } ${d} else {colorMask *= 0.9;}
      }`;
  }
  getShadowTestCode(scene) {
    return '';
  }
  getShadowTestCodeVol(scene) {
    var id = this.id;
    var self = this;
    return this.getIntersectCodeVol(scene,`
      vec3 Vhit = Vorigin+Vray*${this.intersectStr};
      /*vec3 sceneHit = (vec4(Vhit,1.) * ${this.transformStr}).xyz;
      ${this.intersectStr} = distance(origin, sceneHit) / lray;
      if (${this.intersectStr} < t) {*/
        const float step_size = 1.;
        const float sigma_t = ${toFloat(this.sigma_a+this.sigma_s)}; // extinction coefficient

        vec2 tval = intersectVolume2(Vhit, Vray, ${toVec(3,this.getMin())}, ${toVec(3,this.getMax())});
  
        int ns = int((tval.y - tval.x) / step_size)+1;
        float stride = (tval.y - tval.x) / float(ns);
        float tau = 0.;
        for (int i = 0; i < 50; i++) {
          if (i >= ns) break;
          float t = tval.x + stride * (float(i) + 0.5);
          vec3 sample_pos = Vhit + t * Vray;
          tau += ${this.voxel.sample('sample_pos')};
        }
        shadowIntensity *= exp(-tau * stride * sigma_t);
      //}
      `);
  }
  setUniforms2(renderer) {
    //renderer.uniforms[this.minStr] = this.getMinCorner();
  }
  getMin() {
    return [0,0,0];
  }
  getMinCorner2(poslist) {
    return new Vector(this.getMin());
  }
  getMax() {
    return this.voxel.size;
  }
  getMaxCorner2(poslist) {
    return new Vector(this.getMax());
  }
}

class TextureBuffer {
  constructor(type,data,groupsize) {
    this.texture = WuglInst.createTexture(1,1,{
      filter: gl.NEAREST,
    });
    switch (type) {
      case "index":
        this.type = "int";
        this.encode = v => [Math.floor(v)%255,Math.floor(v/255)%255,Math.floor(v/255/255)%255,255];
        this.decode = v => `int(${v}.r*255.+0.5)+int(${v}.g*255.+0.5)*255+int(${v}.b*255.+0.5)*255*255`;
      break;
      case "int":
        this.type = "int";
        this.encode = v => [Math.floor(v+8290687)%255,Math.floor((v+8290687)/255)%255,Math.floor((v+8290687)/255/255)%255,255];
        this.decode = v => `int(${v}.r*255.+0.5)+int(${v}.g*255.+0.5)*255+int(${v}.b*255.+0.5)*255*255-8290687`;
      break;
      default:
        this.type = type;
        this.encode = v => [Math.floor((v+127)*255*255)%255,Math.floor((v+127)*255)%255,Math.floor(v+127)%255,255];
        //this.decode = v => `${v}.r/255.+${v}.g+${v}.b*255.-127.`;
        //this.decode = v => `float(int(${v}.r*255.+0.5))/255./255.+float(int(${v}.g*255.+0.5))/255.+float(int(${v}.b*255.+0.5))-127.`;
        this.decode = v => `floor(${v}.r*255.+0.5)/255./255.+floor(${v}.g*255.+0.5)/255.+floor(${v}.b*255.+0.5)-127.`;
        //this.decode = v => `${v}.r/255.+${v}.g+floor(${v}.b*255.+0.5)-127.`;
      break;
    }
    this.datalength = 0;
    this.data = [];
    this.groupsize = groupsize||1;
    if (data) this.fillData(data);
  }
  fillData(data) {
    //console.log(data);
    this.data = data;
    data = data.flat();
    if (data.some(isNaN)) return;
    this.datalength = data.length;
    if (this.type == "vec3") this.datalength /= 3;
    if (this.type == "vec2") this.datalength /= 2;
    //var w = data.length > 100 ?Math.floor(Math.sqrt(data.length)*3/2) : 100;
    var w = data.length > 100 ?Math.floor(Math.sqrt(data.length)*6/5) : 100;
    if (this.type == "vec3") w = Math.floor(w/3)*3;
    if (this.type == "vec2") w = Math.floor(w/2)*2;
    //var w = 100;
    //console.log(w);
    this.width = Math.min(data.length,w);
    this.height = Math.ceil(data.length/w);
    var self = this;
    var pixels = new Array(this.width*this.height)
      .fill(0)
      .map((v,i) => 
        i < data.length ? 
          self.encode(data[i]) :
          [0,0,0,255]
      ).flat();
    //console.log(ui,this.width,this.height,pixels)
    var pixeldata = new Uint8Array(pixels);
    //console.log(data);
    this.texture.fillData(pixeldata, this.width, this.height);
  }
  copyData(texbuf) {
    this.fillData(texbuf.data);
  }
  get texStr() {return 'texBuf'+this.id;}
  get sampleStr() {return 'sampleTexBuf'+this.id;}
  get length() {
    return this.datalength;
  }
  sample(index,offset) {
    if (this.datalength > 0) {
      if (this.groupsize > 1) {
        return `${this.sampleStr}(${index},${offset})`;
      } else {
        return `${this.sampleStr}(${index})`;
      }
    }
    switch (this.type) {
      case "int": return '0';
      case "index": return '0';
      case "float": return '0.';
      case "vec3": return 'vec3(0)';
      case "vec2": return 'vec2(0)';
    }
  }
  getUV(uv,index) {
    //if (this.height == 1) return `vec2((2*${index}+1)/${toFloat(2*this.width)},0.5)`;
    return `
      vec2 ${uv} = vec2(${index} - (${index} / ${this.width}) * ${this.width}, ${index} / ${this.width} + dy);
      ${uv} = (${uv} + 0.5) / vec2(${this.width},${this.height});
    `;
    //return `vec2(float(2 *  * ${this.width}) + 1) / ${toFloat(2*this.width)}, float(2 * () + 1) / ${toFloat(2*this.height)})`;
    //return `vec2((${index} - floor(${index}/${toFloat(this.width)}) * ${toFloat(this.width)} + 0.5 ) / ${toFloat(this.width)}, (floor(${index}/${toFloat(this.width)}) + 0.5) / ${toFloat(this.height)})`;
  }
  getContent() {
    //var buf = ui.scene.objects[1]?.model?.buffers?.nodebounds;
    if (this.type == 'vec3') {
      return `
      ${this.getUV('uv_x','(index*3)')}
      vec4 tex_x = texture2D(${this.texStr},uv_x);
      float x = ${this.decode('tex_x')};
      ${this.getUV('uv_y','(index*3+1)')}
      vec4 tex_y = texture2D(${this.texStr},uv_y);
      float y = ${this.decode('tex_y')};
      ${this.getUV('uv_z','(index*3+2)')}
      vec4 tex_z = texture2D(${this.texStr},uv_z);
      float z = ${this.decode('tex_z')};
      return vec3(x,y,z);`;
    }
    if (this.type == 'vec2') {
      return `
      ${this.getUV('uv_x','(index*2)')}
      vec4 tex_x = texture2D(${this.texStr},uv_x);
      float x = ${this.decode('tex_x')};
      ${this.getUV('uv_y','(index*2+1)')}
      vec4 tex_y = texture2D(${this.texStr},uv_y);
      float y = ${this.decode('tex_y')};
      return vec2(x,y);`;
    }
    return `
      ${this.getUV('uv','index')}
      vec4 tex = texture2D(${this.texStr},uv);
      return ${this.decode('tex')};`;
  }
  getGlobalCode() {
    if (this.datalength == 0) return ``;
    var t = 1;
    var dl = this.datalength;
    if (this.type == 'vec3') t = 3;
    if (this.type == 'vec2') t = 2;
    dl *= t;
    t *= this.groupsize;
    var s = Math.floor(32768/t);
    var m = Math.floor(s/this.width);
    if (t == 1 || dl < m*this.width) {
      if (this.groupsize > 1) {
        var str = `
          uniform sampler2D ${this.texStr};
          ${this.type} ${this.sampleStr}(int index, const int offset) {
            const int dy = 0;
            index = index*${this.groupsize}+offset;
            ${this.getContent()}
          }`;
        return str;
      } else {
        var str = `
          uniform sampler2D ${this.texStr};
          ${this.type} ${this.sampleStr}(int index) {
            const int dy = 0;
            ${this.getContent()}
          }`;
        return str;
      }
    }
    if (this.groupsize > 1) {
      var str = `
        uniform sampler2D ${this.texStr};
        ${this.type} ${this.sampleStr}(int index, const int offset) {
          int c = index / ${m*this.width};
          int dy = c * ${m*t};
          index = index - c * ${m*this.width};
          index = index*${this.groupsize}+offset;
          ${this.getContent()}
        }`;
      return str;
    } else {
      var str = `
        uniform sampler2D ${this.texStr};
        ${this.type} ${this.sampleStr}(int index) {
          int c = index / ${m*this.width};
          int dy = c * ${m*t};
          index = index - c * ${m*this.width};
          ${this.getContent()}
       }`;
      return str;
    }
    //console.log(str);
  }
} 

class Composite extends TracerObject {
  constructor(id, cubes, spheres, material) {
    super(id,material);
    this.cubes = cubes||[];
    this.spheres = spheres||[];
    this.type = "Composite";
  }
  get functionStr() {return 'intersectComposite' + this.id;}
  newCube(cubeMin,cubeMax) {
    if (cubeMin instanceof Vector) cubeMin = cubeMin;
    if (cubeMax instanceof Vector) cubeMax = cubeMax;
    this.cubes.push({min:cubeMin,max:cubeMax});
  }
  newSphere(sphereCenter,sphereRadius) {
    if (sphereCenter instanceof Vector) sphereCenter = sphereCenter;
    this.spheres.push({center:sphereCenter,radius:sphereRadius});
  }
  getGlobalCode2() {
    var m = this.model;
    var self = this;
    var mins = self.getMin().map(o=>o-0.01);
    var maxes = self.getMax().map(o=>o+0.01);
    var culling = (self.material.type == 3 || self.material.type == 5) ? 'inside, ' : '';
    var str = `
float ${self.functionStr}(vec3 origin, vec3 ray, inout vec2 uv, inout vec3 normal, inout bool inside, inout vec3 colorMask) {
  float Infinity = INFINITY;
  vec3 invray = 1./ray;
  if (!intersectBox(origin, invray, ${toVec(3,mins)}, ${toVec(3,maxes)})) return -1.;
  //colorMask *= 0.9;
  float t = INFINITY;
  ${this.cubes.map(v=>`
  intersectCube(origin, ray, t, normal, uv, ${culling+toVec(3,v.min)}, ${toVec(3,v.max)});
  `).join('')}
  ${this.spheres.map(v=>`
  intersectSphere(origin, ray, t, normal, uv, ${culling+toVec(3,v.center)}, ${toFloat(v.radius)});
  `).join('')}
  if (t >= INFINITY) return -1.;
  return t;
}
`;
    //console.log(str);
    return str;
  }
  /*getIntersectCode() {
    return `
   vec2 ${this.uvStr} = vec2(0);
   vec3 ${this.normalStr} = vec3(1);
   bool ${this.insideStr} = false;
   float ${this.intersectStr} = ${this.functionStr}(origin, ray, ${this.uvStr}, ${this.normalStr}, ${this.insideStr}, colorMask);
  `;
  }*/
  getObjectIntersect(origin,ray) {
    return `
      ${this.intersectStr} = ${this.functionStr}(${origin}, ${ray}, ${this.uvStr}, ${this.normal2Str}, ${this.insideStr}, colorMask);`;
  }
  applyNormals(hit,ray) {
    return ``;
  }
  setUniforms2(renderer) {
    //renderer.uniforms[this.minStr] = this.getMinCorner();
  }
  getMin() {
    var mins = [Infinity,Infinity,Infinity];
    for (var j = 0; j < this.cubes.length; j++) {
      for (var i = 0; i < 3; i++) {
        mins[i] = Math.min(mins[i],this.cubes[j].min[i]);
      }
    }
    for (var j = 0; j < this.spheres.length; j++) {
      for (var i = 0; i < 3; i++) {
        var s = this.spheres[j];
        mins[i] = Math.min(mins[i],s.center[i]-s.radius);
      }
    }
    return mins;
  }
  getMinCorner2(poslist) {
    return new Vector(this.getMin());
  }
  getMax() {
    var maxes = [-Infinity,-Infinity,-Infinity];
    for (var j = 0; j < this.cubes.length; j++) {
      for (var i = 0; i < 3; i++) {
        maxes[i] = Math.max(maxes[i],this.cubes[j].max[i]);
      }
    }
    for (var j = 0; j < this.spheres.length; j++) {
      for (var i = 0; i < 3; i++) {
        var s = this.spheres[j];
        maxes[i] = Math.max(maxes[i],s.center[i]+s.radius);
      }
    }
    return maxes;
  }
  getMaxCorner2(poslist) {
    return new Vector(this.getMax());
  }
  /*translate(translation) {
    for (var j = 0; j < this.rectangles.length; j++) {
      for (var i = 0; i < 3; i++) {
        this.rectangles[j].min[i] += translation[i];
        this.rectangles[j].max[i] += translation[i];
      }
    }
  }
  intersect(origin, ray) {
    return Cube.intersect(origin, ray, this.getMinCorner(), this.getMaxCorner());
  }*/
}

class Light {
  constructor(id,type,position,val,size) {
    id = id||0;
    this.id = id;
    this.type = type||0;
    /*this.lightStr = "light"+id;
    this.lightUniformStr = "ulight"+id;*/
    this.causticMult = 1.5;
    this.size = size||lightSize;
    this.position = forceVector(position);
    this.temporaryTranslation = new Vector([0, 0, 0]);
    this.intensity = val||lightVal;
  }
  get lightStr() {return 'light' + this.id;}
  get lightUniformStr() {return 'ulight' + this.id;}
  getGlobalCode() {
    return `uniform vec3 ${this.lightUniformStr};`;
  }
  getIntersectCode() {
    return '';
  }
  getShadowTestCode() {
    return '';
  }
  getMinimumIntersectCode() {
    return '';
  }
  getNormalCalculationCode() {
    return '';
  }
  getHitCheck(scene) {
    return '';
  }
  lightUp(scene) {
    var id = this.id;
    var caustic = this.size;
    switch(this.type) {
      case 0: return `
      //if (lightUp1 && lightUp2 || bounce == 0) {
      if (lightUp1 && lightUp2) {
        float distL${id};
        float distT${id};
        rayDistPoint(origin, ray, ${this.lightUniformStr}, distL${id}, distT${id});
        float Lshad${id} = shadow(origin,ray*distT${id});
        //if (distL${id} < ${toFloat(Math.sqrt(caustic))}) {
          //accumulatedColor += colorMask * ${this.getIntensity(scene)} * 0.01 / distL${id} * Lshad${id};
          //accumulatedColor += colorMask * ${this.getIntensity(scene)} * ${toFloat(this.causticMult)} * 0.5 * min(1. / ${toFloat(caustic)}, ${toFloat(caustic)} / distL${id}) * Lshad${id};
          //accumulatedColor += colorMask * ${this.getIntensity(scene)} * ${toFloat(this.causticMult)} * 2. * ${toFloat(caustic)} / PI / (distL${id}+${toFloat(caustic*caustic)}) * Lshad${id};
          accumulatedColor += colorMask * ${this.getIntensity(scene)} * ${toFloat(this.causticMult)} * ${toFloat(caustic)} / (distL${id}+2.*${toFloat(caustic)}*sqrt(distL${id})+${toFloat(caustic*caustic)}) * Lshad${id};
        //}
      }
      `;
      default: return ``
    }
  }
  lightUp2(scene) {
    var id = this.id;
    var caustic = this.size;
    switch(this.type) {
      case 1: return `
      if (lightUp1 && lightUp2) {
        vec3 toL${id} = ray - normalize(${this.lightUniformStr});
        float distL${id} = dot(toL${id},toL${id});
        //if (distL${id} < ${toFloat(Math.sqrt(caustic))}) {
          //accumulatedColor += colorMask * ${this.getIntensity(scene)} * ${toFloat(this.causticMult)} * 0.5 * min(1. / ${toFloat(caustic)}, ${toFloat(caustic)} / distL${id});
          //accumulatedColor += colorMask * ${this.getIntensity(scene)} * ${toFloat(this.causticMult)} * 2. * ${toFloat(caustic)} / PI / (distL${id}+${toFloat(caustic*caustic)});
          accumulatedColor += colorMask * ${this.getIntensity(scene)} * ${toFloat(this.causticMult)} * ${toFloat(caustic)} / (distL${id}+2.*${toFloat(caustic)}*sqrt(distL${id})+${toFloat(caustic*caustic)});
        //}
      }
      `;
      default: return ``
    }
  }
  prepScattering(obj,scene) {
    var od = obj.id;
    var id = this.id;
    return `
      vec3 toLight${id} = ${this.getToLightNormal()};
      toLight${id} = normalize((vec4(toLight${id},0.) * ${obj.transformInvStr}).xyz);
      float phaseHG${id} = phaseHG(-Vray, toLight${id}, g);
      `;
  }
  scattering(obj,scene) {
    var od = obj.id;
    var id = this.id;
    return `
      vec2 Ltval${id} = intersectVolume2(sample_pos, toLight${id}, ${toVec(3,obj.getMin())}, ${toVec(3,obj.getMax())});
      int Lns${id} = int(Ltval${id}.y / step_size / 2.)+1;
      float Lstride${id} = Ltval${id}.y / float(Lns${id});
      float tau${id} = 0.;
      for (int j = 0; j < 50; j++) {
        if (j >= Lns${id}) break;
        float t_light = Lstride${id} * (float(j) + 0.5);
        vec3 light_sample_pos = sample_pos + toLight${id} * t_light;
        tau${id} += ${obj.voxel.sample('light_sample_pos')};
      }
      float light_ray_att${id} = exp(-tau${id} * Lstride${id} * sigma_t);
      
      accumulatedColor += colorMask * ${this.getIntensity(scene)} * light_ray_att${id} * phaseHG${id} * sigma_s * stride * density * 20.;
      `;
  }
  getRawIntensity(scene) {
    var rt = scene.bouncelight;
    var sum = 0;
    for (var i = 0; i < scene.bounces/2; i++) {
      sum += Math.pow(rt,i);
    }
    var div = sum*0.5;
    if (this.intensity instanceof Array || this.intensity instanceof Vector) {
      return toVec(3,this.intensity.map(v=>v/div));
    }
    if (typeof this.intensity === 'number') {
      return toFloat(this.intensity/div);
    }
    return toFloat(1/div);
  }
  getIntensity(scene) {
    var intensity = this.getRawIntensity(scene);
    if (!scene.atmosphere) return intensity;
    return `(${intensity} * ${toVec(3,this.filterlight)})`;
  }
  getSelfShadow(mat,obj) {
    var id = this.id;
    if (mat.depthmap instanceof Texture) {
      return `
    
    //vec3 ntolight${id} = normalize(transpose(TBN) * toLight${id});
    ${(obj.transformInvStr ? `
      vec3 ntolight${id} = normalize((vec4(normalize(toLight${id}),0) * ${obj.transformInvStr}).xyz);
      ntolight${id} = normalize(transpose(TBN) * ntolight${id});
    ` : `
      vec3 ntolight${id} = normalize(transpose(TBN) * normalize(toLight${id}));
    `)}
    
    vec2 luv${id} = uv.xy;
    cheight = 1.-${mat.depthmap.texture2D(`luv${id}.xy * ${toFloat(mat.texScale)}`)}.r;
    cdepth = cheight;
    float ldepth${id} = (1.-cdepth) / numLayers;
    
    p = ntolight${id}.xy / ntolight${id}.z * ${toFloat(mat.heightmultiplier)} * ldepth${id}; 

    for (int i = 0; i < int(numLayers); i++) {
      luv${id} += p;
      cheight = 1.-${mat.depthmap.texture2D(`luv${id}.xy * ${toFloat(mat.texScale)}`)}.r;
      cdepth += ldepth${id};
      if (cdepth < cheight) {
        shadowIntensity${id} = 0.;
        break;
      }
    }
    
      `;
    }
    if (mat.heightmap instanceof Texture) {
      return `
    
    //vec3 ntolight${id} = normalize(transpose(TBN) * toLight${id});
    ${(obj.transformInvStr ? `
      vec3 ntolight${id} = normalize((vec4(normalize(toLight${id}),0) * ${obj.transformInvStr}).xyz);
      ntolight${id} = normalize(transpose(TBN) * ntolight${id});
    ` : `
      vec3 ntolight${id} = normalize(transpose(TBN) * normalize(toLight${id}));
    `)}
    
    vec2 luv${id} = uv.xy;
    cheight = ${mat.heightmap.texture2D(`luv${id}.xy * ${toFloat(mat.texScale)}`)}.r;
    cdepth = cheight;
    float ldepth${id} = (1.-cdepth) / numLayers;
    
    p = ntolight${id}.xy / ntolight${id}.z * ${toFloat(mat.heightmultiplier)} * ldepth${id}; 

    for (int i = 0; i < int(numLayers); i++) {
      luv${id} += p;
      cheight = ${mat.heightmap.texture2D(`luv${id}.xy * ${toFloat(mat.texScale)}`)}.r;
      cdepth += ldepth${id};
      if (cdepth < cheight) {
        shadowIntensity${id} = 0.;
        break;
      }
    }
    
      `;
    }
    return '';
  }
  lambertianLight(mat,obj,scene) {
    var id = this.id;
    return `
// compute diffuse lighting contribution
 vec3 toLight${id} = ${this.getToLight()};
 float diffuse${id} = max(0.0, dot(normalize(toLight${id}), normal));

// trace a shadow ray to the light
 float shadowIntensity${id} = shadow(hit + normal * EPSILON, toLight${id});
 ${this.getSelfShadow(mat,obj)}

// do light bounce
 accumulatedColor += colorMask * (${this.getIntensity(scene)} * diffuse${id} * shadowIntensity${id});
 //accumulatedColor += colorMask * specularHighlight${id} * shadowIntensity${id};`;
  }
  specularLight(mat,obj,scene) {
    var id = this.id;
    return `
 vec3 toLight${id} = ${this.getToLight()};
 vec3 reflectedLight${id} = normalize(reflect(normalize(toLight${id}), normalize(normal)));
 float specularHighlight${id} = max(0.0, dot(reflectedLight${id}, normalize(hit-origin)));
 specularHighlight${id} = 2.0 * pow(specularHighlight${id}, 20.0);

// trace a shadow ray to the light
 float shadowIntensity${id} = shadow(hit + normal * EPSILON, toLight${id});

  ${this.getSelfShadow(mat,obj)}

// do light bounce
accumulatedColor += colorMask * ${this.getIntensity(scene)} * specularHighlight${id} * shadowIntensity${id};`;
  }
  getToLight() {
    switch(this.type) {
      case 0: return `${this.lightStr} - hit`;
      case 1: return `${this.lightStr} * INFINITY`;
      default: return `vec3(0.,INFINITY,0.)`
    }
  }
  getToLightNormal() {
    switch(this.type) {
      case 0: return `normalize(${this.lightStr} - hit)`;
      case 1: return `normalize(${this.lightStr})`;
      default: return `vec3(0.,1.,0.)`
    }
  }
  getSetLight() {
    var shift = this.size > 0 ? ` + uniformlyRandomVector(timeSinceStart - 53.0) * ${toFloat(this.size)}` : '';
    switch(this.type) {
      case 0: return `
  vec3 ${this.lightStr} = ${this.lightUniformStr}${shift};`;
      case 1: return `
  vec3 ${this.lightStr} = normalize(${this.lightUniformStr})${shift};`;
      default: return `
        vec3 ${this.lightStr} = ${this.lightUniformStr};`;
    }
  }
  setUniforms(renderer) {
    renderer.uniforms[this.lightUniformStr] = this.position.add(this.temporaryTranslation);
  }
  static clampPosition(position) {
    for (var i = 0; i < position.length; i++) {
      position[i] = Math.max(this.size - 1, Math.min(1 - this.size, position[i]));
    }
  }
  temporaryTranslate(translation) {
    this.temporaryTranslation = translation;
  }
  translate(translation) {
    this.position = this.position.add(translation);
    //Light.clampPosition(this.position);
  }
  getMinCorner() {
    return this.position.add(this.temporaryTranslation).subtract(new Vector([this.size, this.size, this.size]));
  }
  getMaxCorner() {
    return this.position.add(this.temporaryTranslation).add(new Vector([this.size, this.size, this.size]));
  }
  getDistanceSq(point) {return 0;}
  getArea() {return 0;}
  intersect(origin, ray) {
    //return Number.MAX_VALUE;
    return Cube.intersect(origin, ray, this.getMinCorner(), this.getMaxCorner());
  }
}

class BallLight extends Light {
  constructor() {
     super(...arguments);
  }
  getIntersectCode() {
    return '';
  }
  getShadowTestCode() {
    return '';
  }
  getMinimumIntersectCode() {
    return '';
  }
  getNormalCalculationCode() {
    return '';
  }
  getHitCheck(scene) {
    return '';
  }
}

class Camera {
  constructor() {
    this.position = new Vector([0,0,0]);
    this.lookat = new Vector([0,0,0]);
    this.exposure = 1;
    this.do_updates = true;
  }
  getEyeRay(matrix,x,y) {
    return matrix.multiply(new Vector([x, y, 0, 1])).divideByW().ensure3().subtract(this.position);
  }
  mvpInv() {
    return this.modelviewProjection.inverse();
  }
  mvpJitterInv() {
    var jitter = Transform.Translation(new Vector([Math.random() * 2 - 1, Math.random() * 2 - 1, 0]).multiply(1 / 512));
    var inverse = jitter.multiply(this.modelviewProjection).inverse();
    return inverse;
  }
  update(zoomZ,angleX,angleY) {
    if (this.do_updates) {
      this.position[0] = zoomZ * Math.sin(angleY) * Math.cos(angleX);
      this.position[1] = zoomZ * Math.sin(angleX);
      this.position[2] = zoomZ * Math.cos(angleY) * Math.cos(angleX);
    }
    
    this.modelview = makeLookAt(this.position, this.lookat, [0, 1, 0]);
    this.projection = makePerspective(55, 1, 0.1, 100);
    this.modelviewProjection = this.projection.multiply(this.modelview);
  }
  setUniforms(renderer) {
    renderer.uniforms.eye = this.position;
    var matrix = this.mvpJitterInv();
    renderer.uniforms.ray00 = this.getEyeRay(matrix, -1, -1);
    renderer.uniforms.ray01 = this.getEyeRay(matrix, -1, +1);
    renderer.uniforms.ray10 = this.getEyeRay(matrix, +1, -1);
    renderer.uniforms.ray11 = this.getEyeRay(matrix, +1, +1);
  }
}

var debugMode=false;
class PathTracer {
  constructor() {
    this.quadGeometry = WuglInst.createGeometry("Quad",{
      vertexLoc: "vertex",
      usage: gl.STATIC_DRAW
    });

    // create framebuffer
    this.framebuffer = WuglInst.createFramebuffer();

    // create textures
    if (WuglInst.gl_version == "webgl2") this.type = gl.getExtension("EXT_color_buffer_float") ? gl.FLOAT : gl.UNSIGNED_BYTE;
    else this.type = gl.getExtension('OES_texture_float') ? gl.FLOAT : gl.UNSIGNED_BYTE;
    this.textures = [];
    for (var i = 0; i < 2; i++) {
      var tex = WuglInst.createTexture(512,512,{
        filter: gl.NEAREST,
        format: gl.RGB,
        mipmap: false,
        sourceFormat: gl.RGB,
        sourceType: this.type
      });
      tex.fillData(null);
      this.textures.push(tex);
    }

    // create render shader
    this.renderProgram = WuglInst.createProgram(renderVertexSource, renderFragmentSource);
    
    // objects and shader will be filled in when setScene() is called
    this.objects = [];
    this.scenetextures = [];
    this.sampleCount = 0;
    this.tracerProgram = null;
  }
  setScene(scene,camera) {
    scene.orderObjects(camera.position);
    this.objects = scene.objects;
    this.camera = camera;

    // create tracer shader
    if (this.tracerProgram != null) {
      this.tracerProgram.deleteProgram();
    }
    this.scenetextures = scene.getTextures();
    //this.scenetextures.unshift(new TextureBuffer('vec3'));
    for (var i = 0; i < this.scenetextures.length; i++) {
      var t = this.scenetextures[i];
      if (t instanceof TextureBuffer && t.datalength <= 0) continue;
      t.id = (i+1);
    }
    var tracerFragmentSource = makeTracerFragmentSource({
      objects: scene.objects,
      volumes: scene.volumes,
      lights: scene.lights,
      background: scene.background,
      textures: this.scenetextures,
      bounces: scene.bounces||bounces,
      bouncelight: scene.bouncelight||0.5,
      debug: debugMode||scene.debugMode,
      camera: camera
    });
    //console.log(tracerFragmentSource.split("\n").map((v,i)=>i+": "+v).join("\n"));
    window.logTracer = ()=>{console.log(tracerFragmentSource.split("\n").map((v,i)=>i+": "+v).join("\n"))};
    //console.log(tracerFragmentSource);
    this.tracerProgram = WuglInst.createProgram(tracerVertexSource, tracerFragmentSource);
  }
  update(timeSinceStart) {
    var p = this.tracerProgram;
    // calculate uniforms
    for (var i = 0; i < this.objects.length; i++) {
      this.objects[i].setUniforms(p);
    }
    this.camera.setUniforms(p);
    p.uniforms.timeSinceStart = timeSinceStart % 100;
    p.uniforms.textureWeight = this.sampleCount / (this.sampleCount + 1);
    
    var texs = this.scenetextures;
    for (var i = 0; i < texs.length; i++) {
      if (texs[i] instanceof TextureBuffer && texs[i].datalength <= 0) continue;
      if (!texs[i].texture) continue;
      if (texs[i].texture instanceof Wugl.Texture2D) {
        p.uniforms[texs[i].texStr] = texs[i].texture;
      } else if (texs[i].texture instanceof Wugl.Texture3D) {
        p.uniforms[texs[i].texStr] = texs[i].texture;
      } else {
        var tex = WuglInst.createTexture();
        tex.texture = texs[i].texture;
        p.uniforms[texs[i].texStr] = tex;
      }
    }
    
    p.uniforms.tex = this.textures[0];
    
    p.renderToTexture(this.quadGeometry, this.textures[1], this.framebuffer);

    // ping pong textures
    this.textures.reverse();
    this.sampleCount++;
  }
  render() {
    this.renderProgram.uniforms.tex = this.textures[0];
    this.renderProgram.render(this.quadGeometry);
  }
}

class Renderer {
  constructor() {
    this.lineProgram = WuglInst.createProgram(lineVertexSource, lineFragmentSource);
    this.lineGeometry = WuglInst.createGeometry("WireframeBox",{vertexLoc:'vertex'});

    this.objects = [];
    this.selectedObject = null;
    this.pathTracer = new PathTracer();
  }
  setScene(scene,camera) {
    this.objects = scene.objects;
    this.selectedObject = null;
    this.camera = camera;
    this.pathTracer.setScene(scene,camera);
  }
  update(timeSinceStart) {
    this.pathTracer.update(timeSinceStart);
  }
  render() {
    this.pathTracer.render();

    if (this.selectedObject != null) {
      this.lineProgram.uniforms = {
        cubeMin: this.selectedObject.getMinCorner(),
        cubeMax: this.selectedObject.getMaxCorner(),
        modelviewProjection: this.camera.modelviewProjection.transpose()
      };
      this.lineProgram.render(this.lineGeometry);
    }
  }
}

//
// Initialize a texture and load an image.
// When the image finished loading copy it into the texture.
//

function loadModel(url,onload) {
  var obj = {
    positions:[],
    uvs:[],
    normals:[],
    triangles:[],
    triangleuvs:[],
    trianglenormals:[],
    colors:[],
    url:url
  };
  (async function(){
    var req = await fetch(url);
    var data = await req.text();
    var model = loadObj(data);
    for (var i in model) {
      obj[i] = model[i];
    }
    console.log("Loaded model: "+obj.url);
    //console.log(model);
    onload(obj);
  })();
  return obj;
}

function loadObj(txt) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const triangles = [];
    const triangleuvs = [];
    const trianglenormals = [];
    const colors = [];
    let v = 0;

    const lines = txt.split("\n");

    for (const line of lines){
        const normalizedLine = line.trim();
        if(!normalizedLine || normalizedLine.startsWith("#")) continue;
        const parts = normalizedLine.split(/\s+/g);
        var val = parts.slice(1).map(x => parseFloat(x));
        switch(parts[0]){
            case "v": {
                positions.push(val[0],val[1],val[2]);
                break;
            }
            case "c": { //custom extension
                colors.push(val[0],val[1],val[2]);
                break;
            }
            case "vt": {
                uvs.push(val[0],val[1]);
                break;
            }
            case "vn": {
                normals.push(val[0],val[1],val[2]);
                break;
            }
            case "f": {
              var num = val.length - 2;
              val = parts.slice(1).map(x => x.split("/").map(o=>parseFloat(o)-1));
              for (let t = 0; t < num; ++t) {
                triangles.push(val[0][0],val[t+1][0],val[t+2][0]);
                if (!isNaN(val[0][1])) 
                  triangleuvs.push(val[0][1],val[t+1][1],val[t+2][1]);
                if (!isNaN(val[0][2])) 
                  trianglenormals.push(val[0][2],val[t+1][2],val[t+2][2]);
              }
              break;
            }
        }
    }

    return {
      positions,
      uvs,
      normals,
      triangles,
      triangleuvs,
      trianglenormals,
      colors
    };
}

function loadTexture(gl, url, onload, filter) {
  const texture = WuglInst.createTexture(1,1,{
    filter: filter || gl.LINEAR,
  });

  const pixel = new Uint8Array([127, 127, 255, 255]); // opaque blue
  
  texture.fillData(pixel);

  if (!url) return texture;
  
  const image = new Image();
  image.onload = () => {
    texture.fillData(image);
    console.log("Image loaded: "+url);
    onload(image,texture);
  };
  image.crossOrigin = "";
  image.src = url;

  return texture;
}

function isPowerOf2(value) {
  return (value & (value - 1)) === 0;
}

class Scene {
  constructor() {
    this.ids = 0;
    this.objects = [];
    this.volumes = [];
    this.lights = [];
    this.background = defaultbackground;
    this.bouncelight = 0.5;
    //this.textures = [];
    //this.materials = [];
  }
  newSphere() {
    var o = new Sphere(this.ids++,...arguments);
    this.objects.push(o);
    return o;
  }
  newCylinder() {
    var o = new Cylinder(this.ids++,...arguments);
    this.objects.push(o);
    return o;
  }
  newCone() {
    var o = new Cone(this.ids++,...arguments);
    this.objects.push(o);
    return o;
  }
  newTorus() {
    var o = new Torus(this.ids++,...arguments);
    this.objects.push(o);
    return o;
  }
  newCube() {
    var o = new Cube(this.ids++,...arguments);
    this.objects.push(o);
    return o;
  }
  newModel() {
    var o = new ModelObject(this.ids++,...arguments);
    this.objects.push(o);
    return o;
  }
  newVolume() {
    var o = new Volume(this.ids++,...arguments);
    this.volumes.push(o);
    this.objects.push(o);
    return o;
  }
  newSDF() {
    var o = new SignedDistanceField(this.ids++,...arguments);
    this.objects.push(o);
    return o;
  }
  newTerrainMap() {
    var o = new TerrainMap(this.ids++,...arguments);
    this.objects.push(o);
    return o;
  }
  newComposite() {
    var o = new Composite(this.ids++,...arguments);
    this.objects.push(o);
    return o;
  }
  newLight() {
    var o = new Light(this.ids++,...arguments);
    this.lights.push(o);
    this.objects.push(o);
    return o;
  }
  orderObjects(point) {
    //this.objects = this.objects.sort((a,b)=>a.getDistanceSq(point)-b.getDistanceSq(point));
    this.objects = this.objects.sort((a,b)=>b.getArea()-a.getArea());
  }
  getMaterials() {
    var list = [this.background,...this.objects];
    var mats = [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i].material;
      if (m && !mats.includes(m)) mats.push(m);
    }
    return mats;
  }
  getTextures() {
    var mats = this.getMaterials();
    mats.push(this.background);
    var texs = [];
    function addTex(t) {
      if ((t instanceof Texture || t instanceof ProceduralTexture || t instanceof VoxelData || t instanceof ProceduralVoxelData) && !texs.includes(t)) {
        texs.push(t)
      }
    }
    for (var i = 0; i < mats.length; i++) {
      var k = Object.keys(mats[i]);
      for (var j = 0; j < k.length; j++) {
        var n = k[j];
        var t = mats[i][n];
        addTex(t);
      }
    }
    var list = this.objects;
    for (var i = 0; i < list.length; i++) {
      if (!list[i] || !list[i].model || !list[i].model.buffers) continue;
      list[i].model.generateBVH();
      var k = Object.keys(list[i].model.buffers);
      //console.log(k);
      for (var j = 0; j < k.length; j++) {
        var n = k[j];
        var t = list[i].model.buffers[n];
        if (t instanceof TextureBuffer && !texs.includes(t)) texs.push(t);
      }
      //console.log(list[i]);
    }
    for (var i = 0; i < list.length; i++) {
      var k = Object.keys(list[i]);
      for (var j = 0; j < k.length; j++) {
        var n = k[j];
        var t = list[i][n];
        addTex(t);
      }
    }
    return texs;
  }
}
