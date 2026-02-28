// Connectivity Engine for BPL Parser
// Canonical ordered connectivity passes, reused by browser and tests.

class ConnectivityEngine {
  constructor(parser) {
    this.parser = parser;
  }

  establishConnections() {
    const globalTaskOrder = this.buildGlobalTaskOrder();
    this.createImplicitConnections(globalTaskOrder);
    this.processExplicitArrowConnections();
    this.connectMessageFlows();
    this.handleSpecialConnections(globalTaskOrder);
    this.parser.resolvePendingDataAssociations();
  }

  buildGlobalTaskOrder() {
    const taskOrder = [];
    const lines = this.parser.originalText.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line === '---' || line.match(/^-{3,}$/) || line.startsWith('//') || line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('@')) {
        continue;
      }

      const tasksInLine = this.getTasksCreatedAtLine(i);
      tasksInLine.forEach(taskId => {
        const task = this.parser.tasks[taskId];
        if (task && task.type !== 'branch' && task.type !== 'comment') {
          taskOrder.push({
            id: taskId,
            lineNumber: i,
            lane: task.lane
          });
        }
      });
    }

    return taskOrder;
  }

  getTasksCreatedAtLine(lineNumber) {
    const tasks = [];
    for (const [taskId, line] of Object.entries(this.parser.taskLineNumbers)) {
      if (line === lineNumber) {
        tasks.push(taskId);
      }
    }
    return tasks;
  }

  createImplicitConnections(globalTaskOrder) {
    for (let i = 1; i < globalTaskOrder.length; i++) {
      const prev = globalTaskOrder[i - 1];
      const curr = globalTaskOrder[i];
      const prevTask = this.parser.tasks[prev.id];

      if (this.parser.hasConnectionBreakBetween(prev.lineNumber, curr.lineNumber)) {
        continue;
      }

      if (prevTask && prevTask.type === 'gateway') {
        continue;
      }

      this.parser.addConnection('flow', prev.id, curr.id);
    }
  }

  processExplicitArrowConnections() {
    const lines = this.parser.originalText.split('\n');
    let contextLane = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith('@')) {
        contextLane = line;
        continue;
      }

      if (!line.includes('->') && !line.includes('<-')) {
        continue;
      }

      const connections = this.parseArrowConnections(line, i, contextLane);
      connections.forEach(conn => {
        this.parser.addConnection('flow', conn.from, conn.to);
      });
    }
  }

  parseArrowConnections(line, lineNumber, contextLane = null) {
    const connections = [];
    const parts = this.parser.splitConnections(line);
    const resolvedParts = [];

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part === '->' || part === '<-') {
        resolvedParts.push({ type: 'arrow', value: part });
      } else {
        const taskId = this.resolvePartToTaskId(part, lineNumber, contextLane);
        if (taskId) {
          resolvedParts.push({ type: 'task', value: taskId });
        }
      }
    }

    for (let i = 0; i < resolvedParts.length; i++) {
      const curr = resolvedParts[i];
      if (curr.type !== 'arrow') continue;
      const prev = i > 0 ? resolvedParts[i - 1] : null;
      const next = i < resolvedParts.length - 1 ? resolvedParts[i + 1] : null;
      if (!prev || prev.type !== 'task' || !next || next.type !== 'task') continue;

      if (curr.value === '->') {
        connections.push({ from: prev.value, to: next.value });
      } else if (curr.value === '<-') {
        connections.push({ from: next.value, to: prev.value });
      }
    }

    return connections;
  }

  resolvePartToTaskId(part, lineNumber, contextLane = null) {
    const originalLane = this.parser.currentLane;
    if (contextLane) {
      this.parser.currentLane = contextLane;
    }

    const tasksAtLine = this.getTasksCreatedAtLine(lineNumber);
    const normalized = this.parser.normalizeId(part);

    for (const taskId of tasksAtLine) {
      const task = this.parser.tasks[taskId];
      if (task && (this.parser.normalizeId(task.name) === normalized ||
                  (task.messageName && this.parser.normalizeId(task.messageName) === normalized))) {
        this.parser.currentLane = originalLane;
        return taskId;
      }
    }

    let resolved = this.parser.resolveTaskId(part, false);
    if (!resolved && !this.parser.isSpecialLine(part)) {
      resolved = this.parser.resolveTaskId(part, true);
    }

    this.parser.currentLane = originalLane;
    return resolved;
  }

  connectMessageFlows() {
    const sendTasks = Object.values(this.parser.tasks).filter(task => task.type === 'send');
    const receiveTasks = Object.values(this.parser.tasks).filter(task => task.type === 'receive');

    sendTasks.forEach(sendTask => {
      const messageName = sendTask.messageName;
      if (!messageName) return;

      const matchingReceive = receiveTasks.find(receiveTask =>
        receiveTask.messageName === messageName
      );

      if (matchingReceive) {
        const hasBreak = this.parser.hasConnectionBreakBetween(
          this.parser.taskLineNumbers[sendTask.id],
          this.parser.taskLineNumbers[matchingReceive.id]
        );

        if (!hasBreak) {
          const messageId = `message_${this.parser.normalizeId(messageName)}`;
          if (!this.parser.messages.find(m => m.id === messageId)) {
            this.parser.messages.push({
              type: 'message',
              name: messageName,
              id: messageId,
              sourceRef: sendTask.id,
              targetRef: matchingReceive.id
            });
          }
          this.parser.addConnection('message', sendTask.id, matchingReceive.id, messageName);
        }
      }
    });
  }

  handleSpecialConnections(globalTaskOrder) {
    Object.values(this.parser.tasks).forEach(task => {
      if (task.type === 'gateway' && task.branches) {
        task.branches.forEach(branchId => {
          this.parser.addConnection('flow', task.id, branchId);
        });

        const gatewayIndex = globalTaskOrder.findIndex(t => t.id === task.id);
        let mergePoint = null;

        for (let i = gatewayIndex + 1; i < globalTaskOrder.length; i++) {
          const candidate = globalTaskOrder[i];
          const candidateTask = this.parser.tasks[candidate.id];
          if (candidateTask && candidateTask.type !== 'branch') {
            mergePoint = candidate.id;
            break;
          }
        }

        if (mergePoint) {
          task.branches.forEach(branchId => {
            const hasTerminalOutgoing = this.parser.connections.some(conn =>
              conn.type === 'sequenceFlow' &&
              conn.sourceRef === branchId &&
              conn.targetRef === 'process_end'
            );
            if (!hasTerminalOutgoing) {
              this.parser.addConnection('flow', branchId, mergePoint);
            }
          });
        }
      }
    });

    if (this.parser.tasks['process_start'] && globalTaskOrder.length > 0) {
      const firstNonStartTask = globalTaskOrder.find(task => task.id !== 'process_start');
      if (firstNonStartTask) {
        this.parser.addConnection('flow', 'process_start', firstNonStartTask.id);
      }
    }

    if (this.parser.tasks['process_end']) {
      globalTaskOrder.forEach(task => {
        if (task.id === 'process_end') return;
        const hasOutgoing = this.parser.connections.some(conn =>
          conn.sourceRef === task.id && conn.type === 'sequenceFlow'
        );
        if (!hasOutgoing) {
          this.parser.addConnection('flow', task.id, 'process_end');
        }
      });
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ConnectivityEngine;
} else {
  window.ConnectivityEngine = ConnectivityEngine;
}
