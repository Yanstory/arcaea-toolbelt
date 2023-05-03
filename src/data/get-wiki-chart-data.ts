import { BeyondAddon, Chart, Difficulty, SongData } from "../models/music-play";
import { download } from "../utils/download";

const htmlDocument = document.implementation.createHTMLDocument();

async function initPageDocument(url: string | URL) {
  const response = await fetch(url);
  const page = await response.text();
  htmlDocument.open();
  htmlDocument.write(page);
  htmlDocument.close();
  const base = htmlDocument.createElement("base");
  base.href = new URL(url).origin;
  htmlDocument.head.appendChild(base);
}

const wikiBaseURL = new URL("https://wiki.arcaea.cn");

const pathName = (path: string): string => new URL(path, location.href).pathname;

const wikiURL = (path: string) => new URL(pathName(path), wikiBaseURL);

const wikiConstantTable = wikiURL("定数详表");

interface ConstantChartData {
  name: string;
  pst: number;
  prs: number;
  ftr: number;
  byd: number | null;
  link: string;
}

async function getWikiChartTable() {
  await initPageDocument(wikiConstantTable);
  const constantTableEl = htmlDocument.querySelector("table")!;
  type TD = HTMLTableCellElement;
  function checkCells(cells: TD[]): asserts cells is [TD, TD, TD, TD, TD] {
    if (cells.length !== 5) {
      throw new Error("wiki定数详表格式改变");
    }
  }

  const songs: ConstantChartData[] = [];
  for (let i = 1, rows = constantTableEl.rows, l = rows.length; i < l; i++) {
    const row = rows[i]!;
    const cells = Array.from(row.cells);
    checkCells(cells);
    const [name, past, present, future, beyond] = cells;
    const songName = name.textContent!;
    // Last一系列比较特殊，跳过
    if (songName === "Last" || songName === "Last | Eternity") {
      continue;
    }
    songs.push({
      name: songName,
      pst: +past.textContent!,
      prs: +present.textContent!,
      ftr: +future.textContent!,
      byd: +beyond.textContent!,
      link: new URL(name.querySelector("a")!.href).pathname,
    });
  }
  return songs;
}

function getWikiTableItemsByLabel(label: Element) {
  const nodes: Element[] = [];
  for (let node = label.nextElementSibling; node && !node.matches(".label"); node = node.nextElementSibling) {
    nodes.push(node);
  }
  return nodes;
}

export async function fetchWikiChartData(): Promise<SongData[]> {
  const songs = await getWikiChartTable();
  const songsData: SongData[] = [];
  const difficulties = [Difficulty.Past, Difficulty.Present, Difficulty.Future] satisfies Difficulty[];
  for (const song of songs) {
    const { name, link, byd } = song;
    // 由于歌曲wiki链接是唯一的，因此wiki链接可以作为歌曲id使用
    const songId = link.slice(1);
    const detailPageURL = wikiURL(link);
    await initPageDocument(detailPageURL);
    const [normal, beyond] = Array.from(htmlDocument.querySelectorAll("#right-image img"));
    if (!normal) {
      throw new Error(`${name} 曲绘未找到`);
    }
    const cover = wikiURL(normal.src).toString();
    const labels = Array.from(htmlDocument.querySelectorAll("div#mw-content-text div.label"));
    const bpmLabel = labels.find((label) => label.textContent!.match(/BPM/i))!;
    const bpm = bpmLabel.nextElementSibling!.textContent!;
    const noteLabel = labels.find((label) => label.textContent!.match(/^note/i))!;
    const notes: number[] = getWikiTableItemsByLabel(noteLabel).map((el) => +el.textContent!);
    const levelLabel = labels.find((label) => label.textContent!.match(/等级/i))!;
    const levels: string[] = getWikiTableItemsByLabel(levelLabel).map((el) => el.textContent!);

    const charts = difficulties.map<Chart>((difficulty, i) => ({
      constant: song[difficulty],
      difficulty,
      id: `${songId}@${difficulty}`,
      level: levels[i]!,
      note: notes[i]!,
      songId,
    }));

    if (byd) {
      const addon: BeyondAddon = {};
      if (beyond) {
        addon.cover = wikiURL(beyond.src).toString();
      }
      const lineBreak = htmlDocument.querySelector("#title br");
      if (lineBreak) {
        addon.song = lineBreak.nextSibling?.textContent ?? undefined;
      }
      const bydChart: Chart = {
        constant: byd,
        difficulty: Difficulty.Beyond,
        id: `${songId}@${Difficulty.Beyond}`,
        level: levels[3]!,
        note: notes[3]!,
        songId,
        byd: addon,
      };
      charts.push(bydChart);
    }
    const songData: SongData = {
      bpm,
      cover,
      name,
      id: songId,
      charts,
    };
    songsData.push(songData);
  }
  (() => {
    // Last比较特殊，有五个谱面，两个byd难度和三个曲绘，直接作为固定内容处理
    const song: Partial<Record<Difficulty, number>> = {
      pst: 4.0,
      prs: 7.0,
      ftr: 9.0,
    };
    const notes = [674, 777, 831];
    const songId = "Last";
    const levels = ["4", "7", "9"];
    songsData.push({
      bpm: "175",
      cover: wikiURL("/images/thumb/a/a2/Songs_last.jpg/256px-Songs_last.jpg").toString(),
      id: "Last",
      name: "Last",
      charts: difficulties
        .map<Chart>((difficulty, i) => ({
          constant: song[difficulty]!,
          difficulty,
          id: `${songId}@${difficulty}`,
          level: levels[i]!,
          note: notes[i]!,
          songId,
        }))
        .concat([
          {
            id: `Last | Moment@${Difficulty.Beyond}`,
            constant: 9.6,
            difficulty: Difficulty.Beyond,
            level: "9",
            note: 888,
            songId,
            byd: {
              song: `Last | Moment`,
              cover: wikiURL("/images/thumb/1/1e/Songs_last_byd.jpg/256px-Songs_last_byd.jpg").toString(),
            },
          },
          {
            id: `Last | Eternity@${Difficulty.Beyond}`,
            constant: 9.7,
            difficulty: Difficulty.Beyond,
            level: "9+",
            note: 786,
            songId,
            byd: {
              song: `Last | Eternity`,
              cover: wikiURL("/images/thumb/9/92/Songs_lasteternity.jpg/256px-Songs_lasteternity.jpg").toString(),
            },
          },
        ]),
    });
  })();
  return songsData;
}

export async function generateChartTableFile() {
  const data = await fetchWikiChartData();
  download(URL.createObjectURL(new Blob([JSON.stringify(data)], { type: "application/json" })), "chart-data.json");
}