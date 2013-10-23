var mysql = require('mysql');
var jsonPointer = require('json-pointer');

var SchemaCondition = require('./schema-condition');

function Config(obj) {
	this.table = obj.table;
	this.columns = obj.columns;
	this.keyColumns = obj.keyColumn ? [obj.keyColumn] : obj.keyColumns;
	this.sortedColumns = Object.keys(this.columns);
	this.sortedColumns.sort(function (a, b) {
		return b.length - a.length; // longest first
	});
}
Config.prototype = {
	columnForPath: function (dataPath, type) {
		var columnKey = type + dataPath;
		if (this.columns[columnKey]) {
			if (typeof this.columns[columnKey] === 'object') {
				return mysql.escapeId(this.columns[columnKey].alias || columnKey);
			} else if (typeof this.columns[columnKey] === 'string') {
				return mysql.escapeId(this.columns[columnKey]);
			} else {
				return mysql.escapeId(columnKey);
			}
		}
		return null;
	},
	deconstructColumn: function (column, useAliases) {
		if (useAliases !== false) {
			for (var key in this.columns) {
				if (this.columns[key] === column) {
					column = key;
					break;
				} else if (typeof this.columns[key] === 'object' && this.columns[key].alias === column) {
					column = key;
				}
			}
		}
		var type = column.split('/', 1)[0];
		var dataPath = column.substring(type.length);
		return {
			type: type,
			path: dataPath
		}
	}
};

function createClass(config, constructor, proto) {
	if (!(config instanceof Config)) {
		config = new Config(config);
	}
	if (!proto && typeof constructor === 'object') {
		proto = constructor;
		constructor = undefined;
	}
	// TODO: use tv4 to validate config
	var escapedTable = mysql.escapeId(config.table);
	var initialTableName = "";
	config.table.replace(/([A-Z])/g, function(letter) {return "_"+letter.toLowerCase();}).replace(/[^a-z_0-9]/g, '_').replace(/^_*/, '').replace(/_*$/, '').split('_').forEach(function (entry) {
		initialTableName += entry.charAt(0);
	});

	function NewClass() {
		if (constructor) {
			var _super = {};
			for (var key in proto) {
				_super[key] = proto[key].bind(this);
			}
			var args = [];
			while (args.length < arguments.length) {
				args[args.length] = arguments.length;
			}
			args.unshift(_super);
			constructor.apply(this, args);
		}
	}
	NewClass.prototype = proto || {};
	
	NewClass.sqlFromSchema = function (schema) {
		var condition = SchemaCondition.fromSchema(schema, config);
		var table = initialTableName;
		return 'SELECT ' + table + '.*\n\tFROM ' + escapedTable + ' ' + table + '\n\tWHERE ' + condition.sqlWhere(table, false, '\t');
	};
	
	NewClass.search = function (connection, schema, callback) {
		var sql = NewClass.sqlFromSchema(schema);
		connection.query(sql, function (error, results) {
			if (error) {
				return callback(error);
			}
			for (var i = 0; i < results.length; i++) {
				results[i] = NewClass.fromRow(results[i]);
			}
			callback(null, results);
		});
	};
	
	NewClass.save = function (connection, obj, callback) {
		var updatePairs = [];
		var remainderObject = JSON.parse(JSON.stringify(obj)); // Copy, and also ensure it's JSON-friendly
		var wherePairs = [];
		for (var i = 0; i < config.sortedColumns.length; i++) {
			var column = config.sortedColumns[i];
			var key = config.deconstructColumn(column, false);
			var alias = config.columnForPath(key.path, key.type);
			if (!jsonPointer.has(remainderObject, key.path)) {
				updatePairs.push(alias + "=NULL");
				continue;
			}
			var value = jsonPointer.get(remainderObject, key.path);
			jsonPointer.set(remainderObject, key.path, undefined);
			if (key.type === 'boolean' && typeof value === 'boolean') {
				value = value ? 1 : 0;
			} else if (key.type === 'integer' && typeof value === 'number' && Math.floor(value) === value) {
				// nothing to do
			} else if (key.type === 'number' && typeof value === 'number') {
				// nothing to do
			} else if (key.type === 'string' && typeof value === 'string') {
				// nothing to do
			} else {
				value = null;
			}
			var pair = alias + "=" + mysql.escape(value);
			var index = config.keyColumns.indexOf(column);
			if (index === -1) {
				updatePairs.push(pair);
			} else {
				wherePairs[index] = pair;
			}
		}
		var sql = 'UPDATE ' + escapedTable + '\n\tSET ' + updatePairs.join(',\n\t') + '\nWHERE ' + wherePairs.join(' AND ');
		connection.query(sql, callback);
	};
	
	NewClass.fromRow = function (row) {
		var result = new NewClass();
		for (var key in row) {
			var value = row[key];
			key = config.deconstructColumn(key);
			if (key.type === 'boolean') {
				value = !!value;
			} else if (key.type === 'number') {
				value = parseFloat(value);
			} else if (key.type === 'integer') {
				value = parseInt(value, 10);
			} else if (key.type === 'string') {
				value = "" + value;
			}
			jsonPointer.set(result, key.path, value);
		}
		return result;
	};
	
	return NewClass;
}

var publicApi = createClass;
publicApi.sqlMatchPattern = function (sql, pattern) {
	if (Array.isArray(pattern)) {
		for (var i = 0; i < pattern.length; i++) {
			if (publicApi.sqlMatchPattern(sql, pattern[i])) {	
				return true;
			}
		}
		return false;
	}
	sql = sql.replace(/[ \t\r\n]+/g, ' ');
	var patternSubs = {};
	while (sql.length > 0 || pattern.length > 0) {
		if (sql.charAt(0) === pattern.charAt(0)) {
			sql = sql.substring(1);
			pattern = pattern.substring(1);
		} else if (pattern.charAt(0) === '{') {
			var templateVar = pattern.match(/^[^}]*}/)[0];
			var sqlValue = sql.match(/^[a-zA-Z0-9_]*/)[0];
			if (!sqlValue) {
				return false;
			}
			pattern = pattern.substring(templateVar.length);
			sql = sql.substring(sqlValue.length);
			templateVar = templateVar.substring(1, templateVar.length - 1);

			if (typeof patternSubs[templateVar] === 'undefined') {
				patternSubs[templateVar] = sqlValue;
			} else if (patternSubs[templateVar] !== sqlValue) {
				return false;
			}
		} else {
			return false;
		}
	}
	return true;
};

module.exports = publicApi;