// 上游MIT核心的离线转换产物；请修改build-headless.js后重建。
import { Vec2 } from "../Vec2.mjs";
const inside = (cp1, cp2, p) => (cp2.x - cp1.x) * (p.y - cp1.y) > (cp2.y - cp1.y) * (p.x - cp1.x), intersection = (cp1, cp2, s, e) => {
  const dc = {
    x: cp1.x - cp2.x,
    y: cp1.y - cp2.y
  }, dp = {
    x: s.x - e.x,
    y: s.y - e.y
  }, n1 = cp1.x * cp2.y - cp1.y * cp2.x, n2 = s.x * e.y - s.y * e.x, n3 = 1 / (dc.x * dp.y - dc.y * dp.x);
  return new Vec2(
    (n1 * dp.x - n2 * dc.x) * n3,
    (n1 * dp.y - n2 * dc.y) * n3
  );
};
function polygonArea(vertices) {
  const numVertices = vertices.length;
  if (numVertices < 3)
    return 0;
  let area = 0;
  for (let i = 0; i < numVertices; i++) {
    const currentVertex = vertices[i], nextVertex = vertices[(i + 1) % numVertices];
    area += currentVertex.x * nextVertex.y - currentVertex.y * nextVertex.x;
  }
  return area = Math.abs(area) / 2, area;
}
const SutherlandHodgmanClipping = (subjectPolygon, clipPolygon) => {
  const subjectArea = polygonArea(subjectPolygon);
  if (polygonArea(clipPolygon) > subjectArea) {
    const temp = subjectPolygon;
    subjectPolygon = clipPolygon, clipPolygon = temp;
  }
  let cp1 = clipPolygon[clipPolygon.length - 1], cp2, s, e, outputList = subjectPolygon;
  for (const j in clipPolygon) {
    cp2 = clipPolygon[j];
    let inputList = outputList;
    outputList = [], s = inputList[inputList.length - 1];
    for (const i in inputList)
      e = inputList[i], inside(cp1, cp2, e) ? (inside(cp1, cp2, s) || outputList.push(intersection(cp1, cp2, s, e)), outputList.push(e)) : inside(cp1, cp2, s) && outputList.push(intersection(cp1, cp2, s, e)), s = e;
    cp1 = cp2;
  }
  return outputList;
};
export {
  SutherlandHodgmanClipping
};
