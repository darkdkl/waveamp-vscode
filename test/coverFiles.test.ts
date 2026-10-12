import { describe, expect, it } from "vitest";
import { findFolderCover, pickTagPicture } from "../src/coverFiles";

const data = new Uint8Array([1, 2, 3]);

describe("pickTagPicture", () => {
  it("prefers the front cover", () => {
    const pictures = [
      { type: "Artist/performer", data },
      { type: "Cover (front)", data },
      { type: "Cover (back)", data },
    ];
    expect(pickTagPicture(pictures)?.type).toBe("Cover (front)");
  });

  it("falls back to the first picture and handles none", () => {
    expect(pickTagPicture([{ type: "Other", data }, { data }])?.type).toBe("Other");
    expect(pickTagPicture([])).toBeNull();
    expect(pickTagPicture(undefined)).toBeNull();
  });
});

describe("findFolderCover", () => {
  it("finds common cover file names case-insensitively", () => {
    expect(findFolderCover(["01.flac", "Cover.JPG", "notes.txt"])).toBe("Cover.JPG");
    expect(findFolderCover(["folder.png", "02.mp3"])).toBe("folder.png");
  });

  it("prefers cover over folder/front/album and jpg over png", () => {
    expect(findFolderCover(["album.jpg", "front.jpg", "folder.jpg", "cover.png", "cover.jpg"])).toBe("cover.jpg");
    expect(findFolderCover(["album.png", "front.jpeg"])).toBe("front.jpeg");
  });

  it("ignores other images and missing covers", () => {
    expect(findFolderCover(["back.jpg", "scan01.png", "cover.gif"])).toBeNull();
    expect(findFolderCover([])).toBeNull();
  });
});
