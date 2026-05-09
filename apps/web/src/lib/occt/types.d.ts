/**
 * Hand-written types for `occt-import-js`. The package ships no `.d.ts`,
 * so we describe just the surface the worker needs.
 *
 * Reference: https://github.com/kovacsv/occt-import-js#processing-the-result
 */

declare module 'occt-import-js' {
  interface OcctMesh {
    name: string;
    color?: [number, number, number];
    attributes: {
      position: { array: number[] | Float32Array };
      normal?: { array: number[] | Float32Array };
    };
    index: { array: number[] | Uint32Array };
  }

  interface OcctNode {
    name: string;
    meshes: number[];
    children: OcctNode[];
  }

  interface OcctReadResult {
    success: boolean;
    root?: OcctNode;
    meshes: OcctMesh[];
  }

  interface OcctReadParams {
    linearUnit?: 'millimeter' | 'centimeter' | 'meter' | 'inch' | 'foot';
    linearDeflectionType?: 'bounding_box_ratio' | 'absolute_value';
    linearDeflection?: number;
    angularDeflection?: number;
  }

  interface OcctModule {
    ReadStepFile(content: Uint8Array, params: OcctReadParams | null): OcctReadResult;
    ReadBrepFile(content: Uint8Array, params: OcctReadParams | null): OcctReadResult;
    ReadIgesFile(content: Uint8Array, params: OcctReadParams | null): OcctReadResult;
  }

  interface OcctOptions {
    /**
     * Override emscripten's WASM lookup. The default reads the URL from the
     * loading script tag, which doesn't work in a bundled module worker —
     * we need to point at the static asset path instead.
     */
    locateFile?(path: string, scriptDirectory: string): string;
  }

  /**
   * Default export is a factory: calling it loads the WASM and resolves
   * with the module that has the `ReadStepFile` etc. methods.
   */
  const occtImportJs: (options?: OcctOptions) => Promise<OcctModule>;
  export default occtImportJs;
}
