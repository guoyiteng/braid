Braid Native
============

This is the experimental native backend for Braid. It compiles to LLVM. It resides in a separate directory so the main compiler can avoid a dependency on the native LLVM library.

To use this backend, install its dependencies:

    $ cd native
    $ yarn

The driver for the native compiler is `braidnc`, at `build/native/braidnc.js`.

You will need to have the LLVM dynamic library on your linker path. For example, for my copy of LLVM installed via Homebrew, I had to do this:

    $ export LD_LIBRARY_PATH=`brew --prefix llvm`/lib

By default, `braidnc` writes LLVM IR to stdout. To dump bitcode to a file, use the `-o` option:

    $ braidnc -o program.bc program.ss

Then, an easy way to compile this to native code is using clang:

    $ clang program.bc
    % ./a.out
