// Asset loading that works on the framing page too: it is opened as file://, where fetch() is refused
// but XHR is allowed (--allow-file-access-from-files). Paths are relative to the film's workspace.
export function loadBytes(url: string): Promise<ArrayBuffer> {
  return new Promise((ok, fail) => {
    const x = new XMLHttpRequest();
    x.open('GET', url);
    x.responseType = 'arraybuffer';
    x.onload = () => (x.status === 0 || (x.status >= 200 && x.status < 300) ? ok(x.response as ArrayBuffer) : fail(new Error(`${url}: ${x.status}`)));
    x.onerror = () => fail(new Error(`${url}: load failed`));
    x.send();
  });
}
export const loadText = (url: string) => loadBytes(url).then((b) => new TextDecoder().decode(b));
export const loadJSON = <T = unknown>(url: string) => loadText(url).then((s) => JSON.parse(s) as T);
