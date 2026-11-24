/** Images bundled into main.js as data URLs by esbuild's dataurl loader. */
declare module "*.jpg" {
  const src: string;
  export default src;
}
