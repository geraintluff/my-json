var mysql = require('mysql');
var jsonPointer = require('json-pointer');

function SchemaCondition() {
}
SchemaCondition.prototype = {
	/* Returns the conditions as MySQL conditions that could be used in a "WHERE" clause.
	
	"inverted" means that the conditions are inverted - however, they MUST still fail if the value does not exist (NULL in database).  The usual way to do this is to evaluate to NULL (which works for almost all operators anyway).
	*/
	sqlWhere: function (tableName, inverted, indent) {
		throw new Error('Sub-classes must implement sqlWhere() themselves');
	},
	markIncomplete: function (explanation) {
		var old = this.incomplete.bind(this);
		this.incomplete = function () {
			return [explanation].concat(old());
		};
	},
	incomplete: function () {
		return [];
	},
	not: function () {
		return new InvertedSchemaCondition(this);
	}
};
function InvertedSchemaCondition(original) {
	this.original = original;
}
InvertedSchemaCondition.prototype = {
	sqlWhere: function (tableName, inverted, indent) {
		return this.original.sqlWhere(tableName, !inverted, indent);
	},
	incomplete: function () {
		return this.original.incomplete();
	},
	not: function () {
		return this.original;
	}
};

var allTypes = ['null', 'boolean', 'integer', 'number', 'string', 'object', 'array'];
SchemaCondition.fromSchema = function (schema, config, dataPath) {
	dataPath = dataPath || '';
	var types = null;
	if (typeof schema.types === 'string') {
		types = {};
		types[schema.types] = true; // TODO: type-test
	} else if (Array.isArray(schema.types)) {
		types = {};
		for (var i = 0; i < schema.types.length; i++) {
			var type = schema.types[i];
			types[type] = true; // TODO: type-test
		}
	}

	var allConditions = new SqlAnd();
	var objectConditions = collectObjectConditions(schema, config, dataPath);
	if (objectConditions.length()) {
		if (types) {
			if (types['object']) {
				types['object'] = objectConditions;
			}
		} else {
			var options = new SqlOr();
			options.add(objectConditions);
			options.add
			allConditions.add(options);
		}
	}
	if (schema['enum']) {
		var enumConditions = new EnumConditions(schema, config, dataPath);
		allConditions.add(enumConditions);
	}
	if (schema['allOf']) {
		var allOfConditions = new AllOfConditions(schema, config, dataPath);
		allConditions.add(allOfConditions);
	}
	if (schema['anyOf']) {
		var anyOfConditions = new AnyOfConditions(schema, config, dataPath);
		allConditions.add(anyOfConditions);
	}
	if (schema['not']) {
		var notCondition = new NotCondition(schema, config, dataPath);
		allConditions.add(notCondition);
	}
	
	for (var key in schema) {
		switch (key) {
			case 'type':
			case 'properties':
			case 'enum':
			case 'not':
			case 'anyOf':
			case 'allOf':
				continue;
			default:
				throw new Error('unknown keyword: ' + key);
		}
	}
	return allConditions;
};

function SqlComposite() {
	this.conditions = [];
}
SqlComposite.prototype = Object.create(SchemaCondition.prototype);
SqlComposite.prototype.add = function (condition) {
	this.conditions.push(condition);
};
SqlComposite.prototype.length = function () {
	return this.conditions.length;
};
SqlComposite.prototype.incomplete = function () {
	var result = [];
	for (var i = 0; i < this.conditions.length; i++) {
		var condition = this.conditions[i];
		result = result.concat(condition.incomplete());
	}
	return result;
};

function SqlAnd() {
	SqlComposite.call(this);
	this.sqlWhere = function (tableName, inverted, indent) {
		var parts = [];
		var conditions = this.conditions.slice();
		while (conditions.length > 0) {
			var condition = conditions.shift();
			if (condition instanceof SqlAnd) {
				conditions = condition.conditions.concat(conditions);
				continue;
			}
			parts.push(condition.sqlWhere(tableName, inverted, indent));
		}
		return inverted ? SqlOr.joinStrings(parts, indent) : SqlAnd.joinStrings(parts, indent);
	};
}
SqlAnd.prototype = Object.create(SqlComposite.prototype);
SqlAnd.joinStrings = function (parts, indent) {
	if (typeof indent === 'undefined') {
		indent = '\t';
	}
	indent = indent || '';
	if (parts.length === 0) {
		return '1';
	} else if (parts.length === 1) {
		return parts[0];
	}
	if (indent) {
		for (var i = 0; i < parts.length; i++) {
			parts[i] = parts[i].replace(/\n/g, '\n' + indent);
		}
		return '(\n' + indent + parts.join('\n' + indent + 'AND ') + '\n)';
	} else {
		return '(' + parts.join(' AND ') + ')';
	}
}

function SqlOr() {
	SqlComposite.call(this);
	this.sqlWhere = function (tableName, inverted, indent) {
		var parts = [];
		var conditions = this.conditions.slice();
		while (conditions.length > 0) {
			var condition = conditions.shift();
			if (condition instanceof SqlOr) {
				conditions = condition.conditions.concat(conditions);
				continue;
			}
			parts.push(condition.sqlWhere(tableName, inverted, indent));
		}
		return inverted ? SqlAnd.joinStrings(parts, indent) : SqlOr.joinStrings(parts, indent);
	};
}
SqlOr.prototype = Object.create(SqlComposite.prototype);
SqlOr.joinStrings = function (parts, indent) {
		if (typeof indent === 'undefined') {
			indent = '\t';
		}
		indent = indent || '';
	if (parts.length === 0) {
		return '0';
	} else if (parts.length === 1) {
		return parts[0];
	}
	if (indent) {
		for (var i = 0; i < parts.length; i++) {
			parts[i] = parts[i].replace(/\n/g, '\n' + indent);
		}
		return '(\n' + indent + parts.join('\n' + indent + 'OR ') + '\n)';
	} else {
		return '(' + parts.join(' OR ') + ')';
	}
};

function EnumConditions(schema, config, dataPath) {
	this.sqlWhere = function (tableName, inverted, indent) {
		var options = [];
		var column;
		var comparitor = inverted ? ' != ' : ' = ';
		for (var i = 0; i < schema['enum'].length; i++) {
			var value = schema['enum'][i];
			if (typeof value === 'number' && Math.floor(value) === value && (column = config.columnForPath(dataPath, 'integer'))) {
				options.push(tableName + '.' + mysql.escapeId(column) + comparitor + mysql.escape(value));
			} else if (typeof value === 'number' && (column = config.columnForPath(dataPath, 'number'))) {
				options.push(tableName + '.' + mysql.escapeId(column) + comparitor + mysql.escape(value));
			} else if (typeof value === 'string' && (column = config.columnForPath(dataPath, 'string'))) {
				options.push(tableName + '.' + mysql.escapeId(column) + comparitor + mysql.escape(value));
			} else {
				var errorString = "could not check " + (typeof value) + ' enum for ' + dataPath.replace(/\*/g, '_');
				this.markIncomplete(errorString);
				return (inverted ? '0' : '1') + "/* " + errorString + " */";
			}
		}
		return inverted ? SqlAnd.joinStrings(options) : SqlOr.joinStrings(options);
	}
}
EnumConditions.prototype = Object.create(SchemaCondition.prototype);

function AnyOfConditions(schema, config, dataPath) {
	var orConditions = new SqlOr();
	for (var i = 0; i < schema.anyOf.length; i++) {
		orConditions.add(SchemaCondition.fromSchema(schema.anyOf[i], config, dataPath));
	}
	return orConditions;
}

function AllOfConditions(schema, config, dataPath) {
	var andConditions = new SqlAnd();
	for (var i = 0; i < schema.allOf.length; i++) {
		andConditions.add(SchemaCondition.fromSchema(schema.allOf[i], config, dataPath));
	}
	return andConditions;
}

function NotCondition(schema, config, dataPath) {
	var innerCondition = SchemaCondition.fromSchema(schema.not, config, dataPath);
	this.sqlWhere = function (tableName, inverted, indent) {
		return innerCondition.sqlWhere(tableName, !inverted, indent);
	}
}
NotCondition.prototype = Object.create(SchemaCondition.prototype);

function collectObjectConditions(schema, config, dataPath) {
	var result = new SqlAnd();
	if (schema.properties) {
		for (var key in schema.properties) {
			var subSchema = schema.properties[key];
			var condition = SchemaCondition.fromSchema(subSchema, config, dataPath + "/" + jsonPointer.escape(key));
			result.add(condition);
		}
	}
	return result;
}

module.exports = {
	SchemaCondition: SchemaCondition,
	fromSchema: SchemaCondition.fromSchema,
	SqlOr: SqlOr,
	SqlAnd: SqlAnd
};