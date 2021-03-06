#!/usr/bin/env node

import * as fs from 'fs';
import * as util from 'util';
import * as path from 'path';
import * as minimist from 'minimist';

import * as driver from "../src/driver";
import { Error } from "../src/error";
import { readText, STDIN_FILENAME } from "../cli/cli_util";

const EXTENSION = '.ss';

function run(filename: string, source: string, webgl: boolean,
    compile: boolean, execute: boolean, test: boolean,
    generate: boolean, log: (...msg: any[]) => void, presplice: boolean,
    module: boolean)
{
  let success = true;
  let name = path.basename(filename, EXTENSION);

  try {

    // Configure the driver.
    let config: driver.Config = {
      webgl: webgl,
      generate: generate,

      log: log,
      error: e => {
        if (test) {
          success = driver.check_output(name, source, e.toString());
        } else {
          console.error(e.toString());
          success = false;
        }
      },

      parsed: (_ => void 0),
      typed: (_ => void 0),

      presplice,
      module,
    };

    // Run the driver.
    let sources: string[] = [source];
    let filenames: string[] = [filename];

    let res = driver.frontend(config, sources, filenames);
    if (res instanceof Error) {
      if (test) {
        return driver.check_output(name, source, res.toString());
      } else {
        console.error(res.toString());
        return false;
      }
    }

    let [tree, types] = res;
    if (compile) {
      // Compiler.
      driver.compile(config, tree, types, code => {
        if (execute) {
          driver.execute(config, code, (res) => {
            if (test) {
              success = driver.check_output(name, source, res);
            } else {
              console.log(res);
            }
          });
        } else {
          console.log(code);
        }
      });

    } else {
      // Interpreter.
      driver.interpret(config, tree, types, (res) => {
        if (test) {
          success = driver.check_output(name, source, res);
        } else {
          console.log(res);
        }
      });
    }

  } catch (e) {

    if (test) {
      // Avoid crashing the test harness.
      let name = path.basename(filename, EXTENSION);
      console.log(`${name} ✘: unhandled error`);
      console.error(e.stack || e);
      success = false;
    } else {
      throw e;
    }

  }

  return success;
}

/**
 * Dump a lot of debugging information using Node's `util.inspect`.
 */
function verbose_log(...msg: any[]) {
  let out: string[] = [];
  for (let m of msg) {
    if (typeof(m) === "string") {
      out.push(m);
    } else if (m instanceof Array) {
      for (let i = 0; i < m.length; ++i) {
        out.push("\n" + i + ": " +
            util.inspect(m[i], { depth: undefined, colors: true }));
      }
    } else {
      out.push(util.inspect(m, { depth: undefined, colors: true }));
    }
  }
  // Work around a TypeScript limitation:
  // https://github.com/Microsoft/TypeScript/issues/4755
  console.log(out[0], ...out.slice(1));
}

async function main() {
  // Parse the command-line options.
  let args = minimist(process.argv.slice(2), {
    boolean: ['v', 'c', 'x', 'w', 't', 'g', 'P'],
  });

  // The flags: -v, -c, and -x.
  let verbose: boolean = args['v'];
  let compile: boolean = args['c'];
  let execute: boolean = args['x'];
  let webgl: boolean = args['w'];
  let test: boolean = args['t'];
  let generate: boolean = args['g'];
  let no_presplice: boolean = args['P'];
  let module: boolean = args['m'];

  // Help.
  if (args['h'] || args['help'] || args['?']) {
    console.error("usage: " + process.argv[1] + " [-vcxwtgP] [PROGRAM...]");
    console.error("  -v: verbose mode");
    console.error("  -c: compile (as opposed to interpreting)");
    console.error("  -x: execute the program (use with -c)");
    console.error("  -w: use the WebGL language variant");
    console.error("  -t: test mode (check for expected output)");
    console.error("  -g: dump generated code");
    console.error("  -P: do not use the presplicing optimization");
    console.error("  -m: compile an importable ES6 module");
    process.exit(1);
  }

  // Get the program filenames, or indicate that we'll read code from STDIN.
  let filenames: string[] = args._;
  if (!filenames.length) {
    filenames = [STDIN_FILENAME];
  }

  // Log stuff, if in verbose mode.
  let log = verbose ? verbose_log : (() => void 0);

  // Read each source file and run the driver.
  let success = true;
  await Promise.all(filenames.map(async fn => {
    let source = await readText(fn);
    success = run(fn, source, webgl, compile, execute, test,
        generate, log, !no_presplice, module) && success;
  }));
  if (!success) {
    process.exit(1);
  }
}

main();
