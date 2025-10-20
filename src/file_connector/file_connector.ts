import os from "os";
import path from "path";

export abstract class FileConnector {
  protected _link: string = "";

  public abstract connectToFile<T>(
    dirPath: string,
    fn: (dirPath: string) => Promise<T> | T,
  ): Promise<T>;

  static registry: Record<string, new () => FileConnector> = {};

  static register(key: string, ctor: new () => FileConnector) {
    this.registry[key] = ctor;
  }
  public create_link(link: string) {
    this._link = link;
  }
}

class LocalConnector extends FileConnector {
  public async connectToFile<T>(
    dirPath: string,
    fn: (dirPath: string) => Promise<T> | T,
  ): Promise<T> {
    // replace dirPath to be os.homedir()
    const expanded = dirPath.startsWith("~") ? path.join(os.homedir(), dirPath.slice(1)) : dirPath;

    const dir = path.resolve(expanded);
    // Just run the provided function in that directory and return result
    return await fn(dir);
  }
}
FileConnector.register("local", LocalConnector);
