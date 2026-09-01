/**
 * Plan MCP tools: get_plan_spine, list_plot_nodes, create_plot_node,
 * update_plot_node, delete_plot_node, reorder_plot_nodes, create_plan_thread,
 * apply_structure_template
 *
 * The plan is how a book is DESIGNED before it is written: volumes → acts →
 * chapters → scenes, with beats (PlotNode) hanging off chapters and subplot
 * threads (PlanThread) hanging off volumes. Until now the MCP could create
 * chapter 14 without being able to see which act it landed in or which beat it
 * was meant to carry.
 *
 * ## Why get_plan_spine re-projects instead of forwarding the payload
 *
 * `/plan-spine` includes whole Chapter rows, and a Chapter row carries
 * `content` — the entire prose of the chapter. That is fine for editor-v2,
 * which caches it and is already holding the manuscript. Forwarding it to a
 * model would spend a book's worth of context to answer "what is the shape of
 * this book", and would do it every call. So the tree is walked here and only
 * the structural fields survive. Prose has its own doors: get_chapter and
 * search_book.
 *
 * ## What is deliberately absent
 *
 * `POST /plan/generate-beats` asks a model to invent beats and hands back a
 * draft for the client to materialize. The MCP client IS a model — billing
 * Creader's quota so a second one can draft bullet points is worse output at
 * double the price. Write the beats, then call create_plot_node. Same rule
 * that keeps the nine prose-generation routes unwrapped. (Naming their path
 * prefix here would reach the satellite-drift checker as a dead route: it
 * reads route literals out of this file, comments included.)
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function registerPlanTools(server: McpServer): void;
