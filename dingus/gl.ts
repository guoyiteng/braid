/**
 * The support library for running Atw's WebGL output in an interactive
 * browser widget. This is the support structure that "links" with the
 * compiled program to compose a complete scene.
 */

import mat4 = require('./node_modules/gl-mat4/index.js');
import normals = require('./node_modules/normals/normals.js');
import canvasOrbitCamera =
  require('./node_modules/canvas-orbit-camera/index.js');
import pack = require('./node_modules/array-pack-2d/index.js');
import eye = require('./node_modules/eye-vector/index.js');

import bunny = require('./node_modules/bunny/index.js');
import teapot = require('./node_modules/teapot/teapot.js');
import snowden = require('./node_modules/snowden/index.js');

// Some type aliases for GL data structures.
type Mat4 = Float32Array;
interface Mesh {
  positions: [number, number, number][];
  cells: [number, number, number][];
};

/**
 * Create a WebGL buffer object containing the given data.
 */
function make_buffer(gl: WebGLRenderingContext, data: number[][], type: string, mode: number) {
  // Initialize a buffer.
  var buf = gl.createBuffer();

  // Flatten the data to a packed array.
  var arr = pack(data, type);

  // Insert the data into the buffer.
  gl.bindBuffer(mode, buf);
  gl.bufferData(mode, arr, gl.STATIC_DRAW);

  return buf;
}

/**
 * Evaluate the compiled SHFL code in the context of the globals we provide
 * as externs. Return a setup function that takes no arguments and returns a
 * per-frame function.
 */
function shfl_eval(code: string, gl: WebGLRenderingContext, projection: Mat4, view: Mat4) {
  var dingus = {
    projection: projection,
    view: view,
  };

  // Operations exposed to the language for getting data for meshes.
  function mesh_indices(obj: Mesh) {
    return make_buffer(gl, obj.cells, 'uint16', gl.ELEMENT_ARRAY_BUFFER);
  }
  function mesh_positions(obj: Mesh) {
    return make_buffer(gl, obj.positions, 'float32', gl.ARRAY_BUFFER);
  }
  function mesh_normals(obj: Mesh) {
    var norm = normals.vertexNormals(obj.cells, obj.positions);
    return make_buffer(gl, norm, 'float32', gl.ARRAY_BUFFER);
  }
  function mesh_size(obj: Mesh) {
    return obj.cells.length * obj.cells[0].length;
  }

  // And, similarly, a function for actually drawing a mesh. This takes the
  // indices buffer for the mesh and its size (in the number of scalars).
  function draw_mesh(indices: WebGLBuffer, size: number) {
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indices);
    gl.drawElements(gl.TRIANGLES, size, gl.UNSIGNED_SHORT, 0);
  }

  // Evaluate the code, but wrap it in a function to avoid scope pollution.
  return (function () {
    return eval(code);
  })();
}

// Compute a project matrix (placed in the `out` matrix allocation) given the
// width and height of a viewport.
function projection_matrix(out: Mat4, width: number, height: number) {
  var aspectRatio = width / height;
  var fieldOfView = Math.PI / 4;
  var near = 0.01;
  var far  = 100;

  mat4.perspective(out, fieldOfView, aspectRatio, near, far)
}

// Set up a canvas inside a container element. Return a function that sets the
// render function (given compiled SHFL code as a string).
export = function start_gl(container: HTMLElement, fps_element: HTMLElement) {
  // Create a <canvas> element to do our drawing in. Then set it up to fill
  // the container and resize when the window resizes.
  var canvas = container.appendChild(document.createElement('canvas')) as HTMLCanvasElement;
  function fit() {
    var width = container.clientWidth;
    var height = container.clientHeight;
    canvas.setAttribute('width', width + 'px');
    canvas.setAttribute('height', height + 'px');
  }
  window.addEventListener('resize', fit);
  fit();

  // Attach a `canvas-orbit-camera` thing, which handles user input for
  // manipulating the view.
  var camera = canvasOrbitCamera(canvas, {});

  // Initialize the OpenGL context with our rendering function.
  var gl = (canvas.getContext("webgl") ||
    canvas.getContext("experimental-webgl")) as WebGLRenderingContext;

  // Create the base matrices to be used
  // when rendering the bunny. Alternatively, can
  // be created using `new Float32Array(16)`
  var projection = mat4.create();
  var view = mat4.create();

  // Bookkeeping for calculating framerate.
  var frame_count = 0;
  var last_sample = new Date();
  var sample_rate = 1000;

  // Initially, the SHFL function does nothing. The client needs to call us
  // back to fill in the function. Then, we will update this variable.
  var shfl_render: { proc: any, env: any } = null;

  // The main render loop.
  function render() {
    // Get the current size of the canvas.
    var width = gl.drawingBufferWidth;
    var height = gl.drawingBufferHeight;

    // Handle user input and update the resulting camera view matrix.
    camera.view(view);
    camera.tick();

    // Update the projection matrix for translating to 2D screen space.
    projection_matrix(projection, width, height);

    // Draw on the whole canvas.
    gl.viewport(0, 0, width, height);

    // Rendering flags.
    gl.enable(gl.DEPTH_TEST);  // Prevent triangle overlap.

    // Invoke the compiled SHFL code.
    if (shfl_render) {
      shfl_render.proc.apply(void 0, shfl_render.env);
    }

    // Framerate tracking.
    ++frame_count;
    var now = new Date();
    var elapsed = now.getTime() - last_sample.getTime();  // Milliseconds.
    if (elapsed > sample_rate) {
      var fps = frame_count / elapsed * 1000;
      if (fps_element) {
        fps_element.textContent = fps.toFixed(2);
      } else {
        console.log(fps + " fps");
      }

      last_sample = now;
      frame_count = 0;
    }

    // Ask to be run again.
    window.requestAnimationFrame(render);
  };

  // Request that the render function get called in the browser's render loop.
  window.requestAnimationFrame(render);

  // Return a function that lets the client update the render body.
  return function (shfl_code: string) {
    // Execute the compiled SHFL code in context.
    var shfl_program = shfl_eval(shfl_code, gl, projection, view);

    // Invoke the setup stage.
    shfl_render = shfl_program();
  };
}
