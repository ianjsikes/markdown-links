/**
 * CONSTANTS
 */
const RADIUS = 4;
const ACTIVE_RADIUS = 6;
const STROKE = 1;
const FONT_SIZE = 14;
const FONT_BASELINE = 15;
const ANIM_SPEED = 250; // In milliseconds

/**
 * UTILITIES
 */

// Calls simulation.tick() until the simulation is done
const tickUntilDone = (simulation) => {
  simulation.stop();
  for (
    let i = 0,
      n = Math.ceil(
        // https://github.com/d3/d3-force/blob/master/README.md#simulation_tick
        Math.log(simulation.alphaMin()) / Math.log(1 - simulation.alphaDecay())
      );
    i < n;
    ++i
  ) {
    simulation.tick();
  }
};

// Performs a breadth-first search of the graph (starting from currentNode)
// shows/hides nodes based on their distance to the currentNode
const bfsHide = ({ adjacencyList, currentNode }, { node, link, text }) => {
  if (!currentNode || !adjacencyList[currentNode]) {
    return;
  }

  let visibleSet = new Set();
  let level = 0;
  let queue = [adjacencyList[currentNode]];
  // The 1 here could be changed to show more nodes
  while (queue.length && level <= 1) {
    let queueLength = queue.length;
    for (let i = 0; i < queueLength; i++) {
      let head = queue.shift();
      visibleSet.add(head.id);

      let allLinks = [...head.links, ...head.backlinks];
      for (const l of allLinks) {
        if (adjacencyList[l] && !visibleSet.has(adjacencyList[l])) {
          queue.push(adjacencyList[l]);
        }
      }
    }
    level += 1;
  }

  // Here display: hidden is used to hide nodes because it makes them
  // not respond to click events. Otherwise, invisible nodes are still
  // clickable, leading to accidental misclicks.
  node.attr("display", (d) => (visibleSet.has(d.id) ? null : "none"));
  text.attr("display", (d) => (visibleSet.has(d.id) ? null : "none"));
  link.attr("display", (d) => {
    const bothEndsAreVisible =
      visibleSet.has(d.source) && visibleSet.has(d.target);
    return bothEndsAreVisible ? null : "none";
  });
};

/**
 * SETUP
 */

// The viewing mode for the graph. Values are "ALL", "FOCUS"
let mode = "ALL";

// The data received from the extension
let state = { adjacencyList: {}, currentNode: undefined };
let zoomLevel = 1; // TODO: Better state management than just global variables?

// This is calculated from state
let d3Data = { nodes: [], edges: [] };

// These are the d3 selectors for each type of element
let d3Selectors = { node: null, text: null, link: null };
let d3Simulation = null;

// The container elements
let svg = null;
let g = null;

// The d3 transition selector, used for animating
let t = null;

let width = 0,
  height = 0;
let zoomHandler = null;
const vscode = acquireVsCodeApi();

const setup = () => {
  /**
   * The seedrandom library is used to guarantee predictable results for
   * d3's random physics-based force layout.
   * Based off of this example: http://bl.ocks.org/nitaku/8746032
   * The seed used here doesn't matter as long as it is the same each time.
   */
  Math.seedrandom("lorem ipsum");

  const element = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  element.setAttribute("width", window.innerWidth);
  element.setAttribute("height", window.innerHeight);
  document.body.appendChild(element);

  const reportWindowSize = () => {
    element.setAttribute("width", window.innerWidth);
    element.setAttribute("height", window.innerHeight);
  };
  window.onresize = reportWindowSize;

  svg = d3.select("svg");
  g = svg.append("g");
  t = svg.transition().duration(ANIM_SPEED);
  width = Number(svg.attr("width"));
  height = Number(svg.attr("height"));

  d3Simulation = d3
    .forceSimulation()
    .force("center", d3.forceCenter(width / 2, height / 2))
    .force(
      "link",
      d3
        .forceLink()
        .id((d) => d.id)
        .distance(70)
    )
    .force("charge", d3.forceManyBody().strength(-300))
    .force("x", d3.forceX())
    .force("y", d3.forceY())
    .alphaDecay(0.05)
    .alphaMin(0.01)
    .stop();

  d3Selectors.link = g.append("g").attr("class", "links").selectAll("line");
  d3Selectors.node = g.append("g").attr("class", "nodes").selectAll("circle");
  d3Selectors.text = g.append("g").attr("class", "text").selectAll("text");

  zoomHandler = d3
    .zoom()
    .scaleExtent([0.2, 3])
    //.translateExtent([[0,0], [width, height]])
    //.extent([[0, 0], [width, height]])
    .on("zoom", resize);

  zoomHandler(svg);

  let modeBtnAll = d3.select("#mode-all");
  let modeBtnFocus = d3.select("#mode-focus");

  modeBtnAll.classed("active", true);
  modeBtnAll.on("click", () => {
    mode = "ALL";
    modeBtnAll.classed("active", true);
    modeBtnFocus.classed("active", false);
    update();
  });
  modeBtnFocus.on("click", () => {
    mode = "FOCUS";
    modeBtnAll.classed("active", false);
    modeBtnFocus.classed("active", true);
    update();
  });

  vscode.postMessage({ type: "ready" });
};

const onClick = function (d) {
  vscode.postMessage({ type: "click", payload: d });
};

const resize = () => {
  if (d3.event) {
    const scale = d3.event.transform;
    zoomLevel = scale.k;
    g.attr("transform", scale);
  }

  const zoomOrKeep = (value) =>
    Math.min(Math.max(value, value / zoomLevel), 1.5 * value);

  const font = Math.max(Math.round(zoomOrKeep(FONT_SIZE)), 1);

  d3Selectors.text.attr("font-size", `${font}px`);
  d3Selectors.text.attr("y", (d) => d.y - zoomOrKeep(FONT_BASELINE));
  d3Selectors.link.attr("stroke-width", zoomOrKeep(STROKE));
  d3Selectors.node.attr("r", zoomOrKeep(RADIUS));
  svg
    .selectAll("circle")
    .filter((_d, i, nodes) => d3.select(nodes[i]).attr("active"))
    .attr("r", zoomOrKeep(ACTIVE_RADIUS));

  document.getElementById("zoom").innerHTML = zoomLevel.toFixed(2);
};

window.addEventListener("message", (event) => {
  const message = event.data;

  switch (message.type) {
    case "refresh":
      state = message.payload;
      update();
      break;
  }

  // Resize to update size of active node
  resize();
});

/**
 * Responsible for updating the visible UI to match the data from the
 * d3 simulation.
 */
const onTick = () => {
  document.getElementById("connections").innerHTML = d3Data.edges.length;
  document.getElementById("files").innerHTML = d3Data.nodes.length;

  d3Selectors.link
    .attr("x1", (d) => d.source.prevX || 0)
    .attr("y1", (d) => d.source.prevY || 0)
    .attr("x2", (d) => d.target.prevX || 0)
    .attr("y2", (d) => d.target.prevY || 0)
    .transition(t)
    .attr("x1", (d) => d.source.x)
    .attr("y1", (d) => d.source.y)
    .attr("x2", (d) => d.target.x)
    .attr("y2", (d) => d.target.y);
  d3Selectors.node
    .transition(t)
    .attr("cx", (d) => d.x)
    .attr("cy", (d) => d.y);
  d3Selectors.text
    .transition(t)
    .attr("x", (d) => d.x)
    .attr("y", (d) => d.y - FONT_BASELINE / zoomLevel);
};

const update = () => {
  const { adjacencyList, currentNode } = state;
  d3Simulation.stop();

  // STEP 1: Compute the new node/edge data from the new state

  let newNodes = d3.values(adjacencyList);
  let oldNodes = new Map(d3Selectors.node.data().map((d) => [d.id, d]));

  d3Data.nodes = newNodes.map((newNode) => {
    let oldNode = oldNodes.get(newNode.id) || {};
    return {
      ...newNode,
      // For some reason (probably because I am bad at D3), the links do not
      // properly transition from their old position to their new position. Instead
      // it seems like they always start the transition from (0,0). So as a hacky way
      // of forcing them to keep their old position, I save the old position to each
      // node before running the simulation.
      prevX: oldNode.x,
      prevY: oldNode.y,
    };
  });

  d3Data.edges = d3.merge(
    d3Data.nodes.map((source) => {
      return source.links.map((target) => ({
        source: source.id,
        target,
      }));
    })
  );

  // STEP 2: Bind the new data to the D3 selectors

  d3Selectors.node = d3Selectors.node
    .data(d3Data.nodes, (d) => d.id)
    .join((enter) =>
      enter
        .append("circle")
        .attr("r", RADIUS)
        .attr("opacity", 1)
        .on("click", onClick)
    );

  d3Selectors.text = d3Selectors.text
    .data(d3Data.nodes, (d) => d.label)
    .join((enter) =>
      enter
        .append("text")
        .text((d) => d.label.replace(/_*/g, ""))
        .attr("opacity", 1)
        .attr("font-size", `${FONT_SIZE}px`)
        .attr("text-anchor", "middle")
        .attr("alignment-baseline", "central")
        .on("click", onClick)
    );

  d3Selectors.link = d3Selectors.link
    .data(d3Data.edges, (d) => [d.source, d.target])
    .join((enter) => enter.append("line").attr("stroke-width", STROKE));

  // STEP 3: Additional modifications to node data (colors, show/hide, etc)

  // Set the current node & label as "active"
  d3Selectors.node.attr("active", (d) => (d.id === currentNode ? true : null));
  d3Selectors.text.attr("active", (d) => (d.id === currentNode ? true : null));

  if (mode === "FOCUS") {
    bfsHide(state, d3Selectors);
  } else {
    // Ensure all of the elements are visible
    d3Selectors.node.attr("display", null);
    d3Selectors.text.attr("display", null);
    d3Selectors.link.attr("display", null);
  }

  d3Simulation.nodes(d3Data.nodes);
  d3Simulation.force("link").links(d3Data.edges);
  d3Simulation.alpha(1).restart();

  d3Simulation.stop();
  tickUntilDone(d3Simulation);
  onTick();

  // Translate "camera" to center the currentNode
  let activeNode = d3Selectors.node.data().find((d) => d.id === currentNode);
  if (activeNode) {
    zoomHandler.translateTo(svg.transition(t), activeNode.x, activeNode.y);
  }
};

/**
 * Start it!
 */
setup();
