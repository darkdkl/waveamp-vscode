export interface TagPicture {
  format?: string;
  type?: string;
  data: Uint8Array;
}

const COVER_BASENAMES = ["cover", "folder", "front", "album"];
const COVER_EXTENSIONS = ["jpg", "jpeg", "png"];

export function pickTagPicture(pictures: TagPicture[] | undefined): TagPicture | null {
  if (!pictures?.length) return null;
  return pictures.find((p) => /front/i.test(p.type ?? "")) ?? pictures[0];
}

export function findFolderCover(fileNames: string[]): string | null {
  const byLowerName = new Map(fileNames.map((name) => [name.toLowerCase(), name]));
  for (const base of COVER_BASENAMES) {
    for (const ext of COVER_EXTENSIONS) {
      const match = byLowerName.get(`${base}.${ext}`);
      if (match) return match;
    }
  }
  return null;
}
