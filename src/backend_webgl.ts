/// <reference path="util.ts" />
/// <reference path="compile.ts" />
/// <reference path="backend_js.ts" />
/// <reference path="backend_glsl.ts" />

const WEBGL_RUNTIME = `
function compile_glsl(gl, type, src) {
  var shader = gl.createShader(type);
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    var errLog = gl.getShaderInfoLog(shader);
    console.error("error: compiling shader:", errLog);
  }
  return shader;
}
function get_shader(gl, vertex_source, fragment_source) {
  var vert = compile_glsl(gl, gl.VERTEX_SHADER, vertex_source);
  var frag = compile_glsl(gl, gl.FRAGMENT_SHADER, fragment_source);
  var program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    var errLog = gl.getProgramInfoLog(program);
    console.error("error linking program:", errLog);
  }
  return program;
}
`.trim();

// Get a JavaScript variable name for a compiled shader program. Uses the ID
// of the outermost (vertex) shader Prog.
function shadersym(progid: number) {
  return "s" + progid;
}

// Get a JavaScript variable name to hold a shader location. Uses the ID of
// the corresponding escape expression inside the shader.
function locsym(escid: number) {
  return "l" + escid;
}

function get_prog_pair(ir: CompilerIR, progid: number) {
  let vertex_prog = ir.progs[progid];

  // Get the fragment program.
  if (vertex_prog.subprograms.length > 1 ||
      vertex_prog.subprograms.length < 1) {
    throw "error: vertex quote must have exactly one fragment quote";
  }
  let fragment_prog = ir.progs[vertex_prog.subprograms[0]];

  return [vertex_prog, fragment_prog];
}

function emit_shader_setup(ir: CompilerIR, progid: number) {
  let [vertex_prog, fragment_prog] = get_prog_pair(ir, progid);

  // Compile and link the shader program.
  let out = "var " + shadersym(vertex_prog.id) +
    " = get_shader(gl, " +
    progsym(vertex_prog.id) + ", " +
    progsym(fragment_prog.id) + ");\n";

  // Get the variable locations.
  for (let esc of vertex_prog.persist) {
    out += "var " + locsym(esc.id) + " = gl.getUniformLocation(" +
      shadersym(vertex_prog.id) + ", " +
      emit_js_string(persistsym(esc.id)) + ");\n";
  }

  return out;
}

function emit_shader_binding(emit: JSCompile, ir: CompilerIR,
    progid: number) {
  let [vertex_prog, fragment_prog] = get_prog_pair(ir, progid);

  // Emit and bind the uniforms.
  let out = "";
  for (let esc of vertex_prog.persist) {
    let value = emit(esc.body);
    let [type, _] = ir.type_table[esc.body.id];

    // The WebGL call we use to bind the uniform depends on the value's type.
    if (type instanceof PrimitiveType) {
      if (type.name === "Int") {
        out += "gl.uniform1i(" +
          locsym(esc.id) + ", " + // location
          paren(value) + // value
          ")";
      } else {
        throw "error: only integer uniforms are supported";
      }
    } else {
      throw "error: uniforms must be primitive types";
    }

    out += ",\n";
  }

  // TODO varying/attributes!

  // Bind the shader program.
  out += "gl.useProgram(" + shadersym(vertex_prog.id) + ")";

  return out;
}

// Extend the JavaScript compiler with some WebGL specifics.
function webgl_compile_rules(fself: JSCompile, ir: CompilerIR):
  ASTVisit<void, string>
{
  let js_rules = js_compile_rules(fself, ir);
  return compose_visit(js_rules, {
    // Compile calls to our intrinsics for binding shaders.
    visit_call(tree: CallNode, p: void): string {
      // Check for the intrinsic that indicates a shader invocation.
      if (vtx_expr(tree)) {
        // For the moment, we require a literal quote so we can statically
        // emit the bindings.
        if (tree.args[0].tag === "quote") {
          let quote = tree.args[0] as QuoteNode;
          return emit_shader_binding(fself, ir, quote.id);
        } else {
          throw "dynamic `vtx` calls unimplemented";
        }
      }

      // An ordinary function call.
      return ast_visit(js_rules, tree, null);
    },
  });
}

// Tie the recursion knot.
function get_webgl_compile(ir: CompilerIR): GLSLCompile {
  let rules = webgl_compile_rules(f, ir);
  function f (tree: SyntaxNode): string {
    return ast_visit(rules, tree, null);
  };
  return f;
}

// Compile the IR to a JavaScript program that uses WebGL and GLSL.
function webgl_compile(ir: CompilerIR): string {
  let _jscompile = get_webgl_compile(ir);
  let _glslcompile = get_glsl_compile(ir);

  // Compile each program to a string.
  let out = "";
  for (let prog of ir.progs) {
    if (prog !== undefined) {
      // Get the procs to compile.
      let procs: Proc[] = [];
      for (let id of ir.quoted_procs[prog.id]) {
        procs.push(ir.procs[id]);
      }

      let code: string;
      if (prog.annotation === "s") {
        // A shader program.
        code = glsl_compile_prog(_glslcompile, ir, prog.id);
      } else {
        // Ordinary JavaScript quotation.
        code = jscompile_prog(_jscompile, prog, procs);
      }

      out += emit_js_var(progsym(prog.id), code, true) + "\n";
    }
  }

  // Compile each *top-level* proc to a JavaScript function.
  for (let id of ir.toplevel_procs) {
    out += jscompile_proc(_jscompile, ir.procs[id]);
    out += "\n";
  }

  // For each *shader* quotation (i.e., top-level shader quote), generate the
  // setup code.
  let setup_parts: string[] = [];
  for (let prog of ir.progs) {
    if (prog !== undefined) {
      if (prog.annotation === "s" &&
          ir.containing_progs[prog.id] == undefined) {
        setup_parts.push(emit_shader_setup(ir, prog.id));
      }
    }
  }
  let setup_code = setup_parts.join("");

  // Compile the main function.
  let main = jscompile_proc(_jscompile, ir.main);

  // Then wrap it in an outer function that includes the setup code.
  let body = setup_code + "return /* render */ " + main + ";"
  out += emit_js_fun(null, [], [], body, false) + "()";

  return out;
}

const WEBGL_INTRINSICS: TypeEnvFrame = {
  vtx: new FunType([new CodeType(INT)], INT),
  frag: new FunType([new CodeType(INT)], INT),
  gl_Position: INT,
  gl_Color: INT,
};

function webgl_elaborate(tree: SyntaxNode): [SyntaxNode, TypeTable] {
  return elaborate(tree, WEBGL_INTRINSICS);
}