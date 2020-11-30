import { select } from 'd3';
import { logger } from '../../logger';
import * as configApi from '../../config';
import common from '../common/common';
import utils from '../../utils';
import mermaidAPI from '../../mermaidAPI';

const MERMAID_DOM_ID_PREFIX = 'classid-';

let config = configApi.getConfig();

let relations = [];
let classes = {};
let namespaces = [];
let namespaceLookup = {};
let nsCounter = 0;
let classCounter = 0;

let funs = [];

export const parseDirective = function(statement, context, type) {
  mermaidAPI.parseDirective(this, statement, context, type);
};

// Todo optimize this by caching existing nodes
const exists = (allNs, _id) => {
  let res = false;
  allNs.forEach(ns => {
    const pos = ns.nodes.indexOf(_id);
    if (pos >= 0) {
      res = true;
    }
  });
  return res;
};

/**
 * Deletes an id from all subgraphs
 */
const makeUniq = (ns, allNamespaces) => {
  const res = [];
  ns.nodes.forEach((_id, pos) => {
    if (!exists(allNamespaces, _id)) {
      res.push(ns.nodes[pos]);
    }
  });
  return { nodes: res };
};

const parseClassName = function(id) {
  let genericType = '';
  let className = id;

  if (id.indexOf('~') > 0) {
    let split = id.split('~');
    className = split[0];
    genericType = split[1];
  }

  return { className: className, type: genericType };
};

/**
 * Function called by parser when a namespace/package node definition has been found
 */
export const addNamespace = function(_id, list, _title) {
  let id = _id.trim();
  let title = _title;
  if (_id === _title && _title.match(/\s/)) {
    id = undefined;
  }

  function uniq(a) {
    const prims = { boolean: {}, number: {}, string: {} };
    const objs = [];

    return a.filter(function(item) {
      const type = typeof item;
      if (item.trim() === '') {
        return false;
      }
      if (type in prims) {
        return prims[type].hasOwnProperty(item) ? false : (prims[type][item] = true); // eslint-disable-line
      } else {
        return objs.indexOf(item) >= 0 ? false : objs.push(item);
      }
    });
  }

  let nodeList = [];

  nodeList = uniq(nodeList.concat.apply(nodeList, list));
  // if (version === 'gen-1') {
  //   logger.warn('LOOKING UP');
  //   for (let i = 0; i < nodeList.length; i++) {
  //     nodeList[i] = lookUpDomId(nodeList[i]);
  //   }
  // }

  id = id || 'namespace' + nsCounter;
  title = title || '';
  title = common.sanitizeText(title, config);
  nsCounter = nsCounter + 1;
  const namespace = { id: id, nodes: nodeList, title: title.trim(), classes: [] };

  console.log('Adding', namespace.id, namespace.nodes);

  // Remove the members in the new subgraph if they already belong to another subgraph
  namespace.nodes = makeUniq(namespace, namespaces).nodes;
  namespaces.push(namespace);
  namespaceLookup[id] = namespace;
  return id;
};

/**
 * Function called by parser when a node definition has been found.
 * @param id
 * @public
 */
export const addClass = function(id, shapeType) {
  let classDef = parseClassName(id);
  // Only add class if it does not exist
  if (typeof classes[classDef.className] !== 'undefined') return;

  classes[classDef.className] = {
    id: classDef.className,
    type: classDef.type,
    shapeType: '',
    cssClasses: [],
    methods: [],
    members: [],
    annotations: [],
    domId: MERMAID_DOM_ID_PREFIX + classDef.className + '-' + classCounter
  };

  if (typeof shapeType !== 'undefined') {
    classes[classDef.className].shapeType = shapeType;
  }

  classCounter++;
};

/**
 * Function to lookup domId from id in the graph definition.
 * @param id
 * @public
 */
export const lookUpDomId = function(id) {
  const classKeys = Object.keys(classes);
  for (let i = 0; i < classKeys.length; i++) {
    if (classes[classKeys[i]].id === id) {
      return classes[classKeys[i]].domId;
    }
  }
};

export const clear = function() {
  relations = [];
  namespaces = [];
  namespaceLookup = {};
  classes = {};
  funs = [];
  funs.push(setupToolTips);
};

export const getNamespaces = function() {
  return namespaces;
};

export const getClass = function(id) {
  return classes[id];
};
export const getClasses = function() {
  return classes;
};

export const getRelations = function() {
  return relations;
};

export const addRelation = function(relation) {
  logger.debug('Adding relation: ' + JSON.stringify(relation));
  addClass(relation.id1, undefined);
  addClass(relation.id2, undefined);

  relation.id1 = parseClassName(relation.id1).className;
  relation.id2 = parseClassName(relation.id2).className;

  relations.push(relation);
};

/**
 * Adds an annotation to the specified class
 * Annotations mark special properties of the given type (like 'interface' or 'service')
 * @param className The class name
 * @param annotation The name of the annotation without any brackets
 * @public
 */
export const addAnnotation = function(className, annotation) {
  const validatedClassName = parseClassName(className).className;
  classes[validatedClassName].annotations.push(annotation);
};

/**
 * Adds a member to the specified class
 * @param className The class name
 * @param member The full name of the member.
 * If the member is enclosed in <<brackets>> it is treated as an annotation
 * If the member is ending with a closing bracket ) it is treated as a method
 * Otherwise the member will be treated as a normal property
 * @public
 */
export const addMember = function(className, member) {
  const validatedClassName = parseClassName(className).className;
  const theClass = classes[validatedClassName];

  if (typeof member === 'string') {
    // Member can contain white spaces, we trim them out
    const memberString = member.trim();

    if (memberString.startsWith('<<') && memberString.endsWith('>>')) {
      // Remove leading and trailing brackets
      theClass.annotations.push(memberString.substring(2, memberString.length - 2));
    } else if (memberString.indexOf(')') > 0) {
      theClass.methods.push(memberString);
    } else if (memberString) {
      theClass.members.push(memberString);
    }
  }
};

export const addMembers = function(className, members) {
  if (Array.isArray(members)) {
    members.reverse();
    members.forEach(member => addMember(className, member));
  }
};

export const cleanupLabel = function(label) {
  if (label.substring(0, 1) === ':') {
    return label.substr(1).trim();
  } else {
    return label.trim();
  }
};

/**
 * Called by parser when a special node is found, e.g. a clickable element.
 * @param ids Comma separated list of ids
 * @param className Class to add
 */
export const setCssClass = function(ids, className) {
  ids.split(',').forEach(function(_id) {
    let id = _id;
    if (_id[0].match(/\d/)) id = MERMAID_DOM_ID_PREFIX + id;
    if (typeof classes[id] !== 'undefined') {
      classes[id].cssClasses.push(className);
    }
  });
};

/**
 * Called by parser when a link is found. Adds the URL to the vertex data.
 * @param ids Comma separated list of ids
 * @param linkStr URL to create a link for
 * @param tooltip Tooltip for the clickable element
 */
export const setLink = function(ids, linkStr, tooltip) {
  const config = configApi.getConfig();
  ids.split(',').forEach(function(_id) {
    let id = _id;
    if (_id[0].match(/\d/)) id = MERMAID_DOM_ID_PREFIX + id;
    if (typeof classes[id] !== 'undefined') {
      classes[id].link = utils.formatUrl(linkStr, config);

      if (tooltip) {
        classes[id].tooltip = common.sanitizeText(tooltip, config);
      }
    }
  });
  setCssClass(ids, 'clickable');
};

/**
 * Called by parser when a click definition is found. Registers an event handler.
 * @param ids Comma separated list of ids
 * @param functionName Function to be called on click
 * @param tooltip Tooltip for the clickable element
 */
export const setClickEvent = function(ids, functionName, tooltip) {
  ids.split(',').forEach(function(id) {
    setClickFunc(id, functionName, tooltip);
    classes[id].haveCallback = true;
  });
  setCssClass(ids, 'clickable');
};

const setClickFunc = function(domId, functionName, tooltip) {
  const config = configApi.getConfig();
  let id = domId;
  let elemId = lookUpDomId(id);

  if (config.securityLevel !== 'loose') {
    return;
  }
  if (typeof functionName === 'undefined') {
    return;
  }
  if (typeof classes[id] !== 'undefined') {
    if (tooltip) {
      classes[id].tooltip = common.sanitizeText(tooltip, config);
    }

    funs.push(function() {
      const elem = document.querySelector(`[id="${elemId}"]`);
      if (elem !== null) {
        elem.addEventListener(
          'click',
          function() {
            utils.runFunc(functionName, elemId);
          },
          false
        );
      }
    });
  }
};

export const bindFunctions = function(element) {
  funs.forEach(function(fun) {
    fun(element);
  });
};

export const lineType = {
  LINE: 0,
  DOTTED_LINE: 1
};

export const relationType = {
  AGGREGATION: 0,
  EXTENSION: 1,
  COMPOSITION: 2,
  DEPENDENCY: 3
};

const setupToolTips = function(element) {
  let tooltipElem = select('.mermaidTooltip');
  if ((tooltipElem._groups || tooltipElem)[0][0] === null) {
    tooltipElem = select('body')
      .append('div')
      .attr('class', 'mermaidTooltip')
      .style('opacity', 0);
  }

  const svg = select(element).select('svg');

  const nodes = svg.selectAll('g.node');
  nodes
    .on('mouseover', function() {
      const el = select(this);
      const title = el.attr('title');
      // Dont try to draw a tooltip if no data is provided
      if (title === null) {
        return;
      }
      const rect = this.getBoundingClientRect();

      tooltipElem
        .transition()
        .duration(200)
        .style('opacity', '.9');
      tooltipElem
        .html(el.attr('title'))
        .style('left', window.scrollX + rect.left + (rect.right - rect.left) / 2 + 'px')
        .style('top', window.scrollY + rect.top - 14 + document.body.scrollTop + 'px');
      el.classed('hover', true);
    })
    .on('mouseout', function() {
      tooltipElem
        .transition()
        .duration(500)
        .style('opacity', 0);
      const el = select(this);
      el.classed('hover', false);
    });
};
funs.push(setupToolTips);

export default {
  parseDirective,
  getConfig: () => configApi.getConfig().class,
  addClass,
  addNamespace,
  bindFunctions,
  clear,
  getNamespaces,
  getClass,
  getClasses,
  addAnnotation,
  getRelations,
  addRelation,
  addMember,
  addMembers,
  cleanupLabel,
  lineType,
  relationType,
  setClickEvent,
  setCssClass,
  setLink,
  lookUpDomId
};
